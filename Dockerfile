# syntax=docker/dockerfile:1
FROM ubuntu:24.04 AS inky-build

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y curl libpixman-1-dev libcairo2-dev libsdl-pango-dev make build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_20.x -o nodesource_setup.sh \
    && bash nodesource_setup.sh \
    && rm -f nodesource_setup.sh \
    && apt-get install -y nodejs


FROM inky-build

COPY *ttf *js *json /frame/

RUN cd /frame \
    && npm ci

ENTRYPOINT ["/usr/bin/node","/frame/ical2png.js"]
