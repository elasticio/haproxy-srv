FROM mhart/alpine-node:5

RUN apk add --update haproxy

COPY package.json /src/

RUN cd /src; npm install

COPY start.js haproxy.cfg.template /src/

CMD ["node", "/src/start.js"]