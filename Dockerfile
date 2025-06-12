FROM ubuntu:24.04

RUN apt-get update \
    && apt-get install -y curl libpixman-1-dev libcairo2-dev libsdl-pango-dev \
    && curl -fsSL https://deb.nodesource.com/setup_20.x -o nodesource_setup.sh \
    && bash nodesource_setup.sh \
    && rm -f nodesource_setup.sh \
    && apt-get install -y nodejs