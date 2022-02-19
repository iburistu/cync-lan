FROM node:bullseye-slim

WORKDIR /usr/local/bin/cync-lan

COPY bootstrap.sh bootstrap.sh

RUN apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends \
        openssl \
        < /dev/null > /dev/null && \
    rm -rf /var/lib/apt/lists/* && \
    /bin/bash -c /usr/local/bin/cync-lan/bootstrap.sh && \
    apt-get remove -y openssl

COPY package.json package.json
COPY package-lock.json package-lock.json
COPY index.js index.js

RUN npm ci

EXPOSE 8080/tcp
EXPOSE 23779/tcp

CMD ["index.js"]