import fs, { ReadStream } from "fs";
import { stat } from "fs/promises";
import { createGunzip } from "zlib";
import { PassThrough, Transform, pipeline } from "stream";
import { promisify } from "util";
import { SingleBar } from "cli-progress";
import axios from "axios";
import zod from "zod";
import JSONStream from "JSONStream";

const pipelineAsync = promisify(pipeline);

/**
 * RegionCode/State abbreviation to file identifier code.
 *
 * GET https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/anthem/{EIN}
 * Lets us pull the negotiated rates files.
 * The response looks something like below.
 * ```
 * {
 *    "In-Network Negotiated Rates Files": { displayname: String, url: String }[],
 *    ...
 * }
 * ```
 * There seems to be a pattern that exists between `displayname` and `url` that can be translated into
 * how we can correlate the file with respective state. For example
 * {
 *    "displayname": "2024-01_NY_39B0_in-network-rates_4_of_9.json.gz"
 *    "url": "https://anthembcbsco.mrf.bcbs.com/2024-01_254_39B0_in-network-rates_4_of_9.json.gz?&Expires={TIMESTAMP}&Signature={ACCESS_KEY}"
 * }
 * If we look at the two key-pair, we can see that the URL's path is almost identical to the displayname or filename except that instead of the state abbreviation,
 * we have a numeric code (`2024-01_NY_39B0_in-network-rates_4_of_9.json.gz` vs `2024-01_254_39B0_in-network-rates_4_of_9.json.gz`).
 * This pattern seems to be consistent with other state abbreviations so it's plausible to assume that this numeric code represent the a state.
 */
enum RegionCode {
  NY = 254,
}

/**
 * This is a loose schema for the pupose of this demo.
 */
const ArrayOfObjects = zod
  .array(zod.record(zod.string(), zod.string()))
  .optional();

const processJSONStream = (zipped: boolean) =>
  [
    zipped && createGunzip(),
    JSONStream.parse("reporting_structure.*"),
    new Transform({
      objectMode: true,
      transform(data: Record<string, unknown>, _, cb) {
        try {
          const reportingPlans =
            ArrayOfObjects.parse(data.reporting_plans) ?? [];
          const inNetworkFiles =
            ArrayOfObjects.parse(data.in_network_files) ?? [];

          if (
            reportingPlans.some(({ plan_name }) => plan_name?.includes(" PPO "))
          ) {
            for (const file of inNetworkFiles) {
              // logging
              const item = {
                ...file,
                plans: reportingPlans?.map((v: any) => v.plan_name).join("|"),
                id: reportingPlans[0]?.plan_id,
                idType: reportingPlans?.[0]?.plan_id_type,
              };
              const url = new URL(file.location);
              if (url.pathname.includes(`_${RegionCode.NY}_`)) {
                this.push(file.location);
              }
            }
          }

          cb();
        } catch (e) {
          // Note: We can do a better handling(ie. logging) here so
          // we don't have to kill the rest of the stream,
          // but this demo's worth we are assuming we won't hit so just propagate.
          cb(e as Error);
        }
      },
    }),
  ].filter(Boolean);

const displayProgress = (totalSizeInBytes: number) => {
  const bar = new SingleBar({});
  bar.start(totalSizeInBytes, 0);

  return new PassThrough({
    transform(chunk, _, cb) {
      bar.increment(chunk.length);
      cb(null, chunk);
    },
    final(cb) {
      bar.stop();
      cb();
    },
  });
};

const processFile = async (input: string, output: string) => {
  let fileSizeInBytes: number;
  let source: ReadStream;
  const start = Date.now();

  if (URL.canParse(input)) {
    const response = await axios({
      method: "GET",
      url: input,
      responseType: "stream",
    });
    fileSizeInBytes = parseInt(response.headers["content-length"]);
    source = response.data;
  } else {
    fileSizeInBytes = (await stat(input)).size;
    source = fs.createReadStream(input);
  }

  await pipelineAsync([
    source,
    displayProgress(fileSizeInBytes),
    ...processJSONStream(input.endsWith(".gz")),
    JSONStream.stringify("[\n", ",", "]\n"),
    fs.createWriteStream(output),
  ]);

  console.log(
    "Total run time in seconds: ",
    ((Date.now() - start) / 1000).toFixed(2)
  );
};

let src: string = "2024-01-01_anthem_index.json.gz";
src = fs.existsSync(src)
  ? src
  : "https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/anthem/2024-01-01_anthem_index.json.gz";

processFile(src, "output.json");
