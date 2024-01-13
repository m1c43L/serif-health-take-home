FROM node:18-alpine

RUN mkdir -p /usr/src
WORKDIR /usr/src

COPY package*.json ./  
RUN npm ci  

CMD npm run start