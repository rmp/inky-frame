FROM ubuntu:24.04

RUN apt-get update \
    && apt-get install -y libgd-perl libical-parser-perl libhttp-tiny-perl libdatetime-format-iso8601-perl perlmagick curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x -o nodesource_setup.sh \
    && bash nodesource_setup.sh \
    && rm -f nodesource_setup.sh \
    && apt-get install nodejs

