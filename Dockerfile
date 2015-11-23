FROM mhart/alpine-node:5

RUN apk add --update haproxy

COPY package.json start.js haproxy.cfg.template /src/

RUN cd /src; npm install

CMD ["node", "/src/start.js"]