# Serif Health Takehome Interview

_submission by: Michael Gilbert (mgilbert214@gmail.com)_


## How to run

This code is should be portable to run on most machines. However, I added a simple docker version just in case. The two ways to run it are:
- Through your machine
    - `npm i`
    - `npm start`
- Through docker
    - `docker build . -t=takehome && docker run -it -v .:/usr/src -v ./node_modules:/usr/src/node_modules takehome` or `npm run docker`

By default, the script will stream the index through the internet, but if you have the file already downloaded on your machine,
you can copy it into this directory and the script will use that instead - this results in faster runtime.

The results are piped to `output.json.gz`.

### Runtimes

Streaming index file from disk: `Total run time in seconds:  297.46`


## Interview

### Solution

The problem involes working on a large file to filter out relevant information pertaining to MRFs of Anthem PPO network in the New York state.

When working with data, I normally like to see some actual values to get a better sense of what I'm dealing with.
But for this case, the file is ~13gb compressed so previewing bits of it was not going to be trivial. 

I started with setting up a basic pipeline where I can get and process data chunk by chunk. My pipeline includes a decompressor for compressed json file, 
json stream that looks at the `reporting_structure` property and converting its elements of nto a Javascript object so its easier to work with.

Once I have the means to handle the data, I moved to the objective which is to find MRFs of Anthem PPO network in the New York state.

Breaking it down to two questions:
1. How can we tell if an MRF is for PPO?
2. How can we tell if an MRF is for the New York state?

(1) Looking at some sample segments, I see some pattern in the `plan_name` of `reporting_plans` where some seem to include what type of health plan the plan is including it's likely employer; for example, `"plan_name": "ANTHEM PPO - WICKSTROM INC - ANTHEM"`. So, I added a filter for every `reporting_structure` that looks for mentions of ` PPO ` and `ANTHEM` in its reporting plan then assumes the MRF's can be for PPO. With consideration of the time, I'm sticking with this basic approach. I imagine we cab be more confident if we actually try to parse plan name and group them to those that follow certain pattern. Then different patterns are handled accordingly. For example, if the `plan_name` is `"ANTHEM PPO - WICKSTROM INC - ANTHEM"` then it can have a template like `<Name> - <Employer> - <Carrier>`. And if there is not a pattern matching what we know, we can log them and try to dig for hints.

(2) To look for the MRF's region/state, I iterate the `in_network_files` and look at the descriptions to check if it contains keyword like ` NY ` or ` New York ` at first. Although, I found some, the results were not convincing because there are bits where the description doesn't mention useful information. For example `In-Network Negotiated Rates Files`. The descriptions seems to be very inconsistent, so I looked at other field which is the `location` or the URL of the file. Looking at the URL there seems to be this pattern 
`<protocol>://<origin>/<filename>?&Expires={TIMESTAMP}&Signature={ACCESS_KEY}`, but looking closely at the filename it seems like we have `YYYY-MM_CODEA_CODEB_in-network-rates_I_of_N.json.gz` -> `2024-01_254_39B0_in-network-rates_4_of_9.json.gz`. I was particularly curious about `CODEA`. PLaying around with the [Anthem EIN lookup](https://www.anthem.com/machine-readable-file/search/) `CODEA` seemed to map to a state or region. I added an explaination in the snippet below. It's also in the code.
```
/**
 * RegionCode/State abbreviation to file identifier code for "In-Network Negotiated Rates Files".
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
 * This pattern seems to be consistent with other state abbreviations for `In-Network Negotiated Rates Files` so it's plausible to assume that this numeric code represent the a state.
 */
enum RegionCode {
  NY = 254,
}
```
With this information, I added a filter to my logic that looks for the `RegionCode` in the URL to know if it's for the New York state.

There are other url patterns that may not fit this format and this this assumptions. To account for those, we can create a url parser that can try to parse the URL and see if it match this format and we can be more confident that our assumption is true. If not, we can log it and inspect the `reporting_structure` to find clue.



### How long it took you to write the script?

- Writing the script is pretty straightforward because I have some experience with working on steams. I would say ~1hr.



