FROM openjdk:8-jdk
RUN apt-get update \
    && apt-get -y install postgresql-client \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

COPY target/universal/stage .

RUN addgroup -S -g 999 webknossos \
  && adduser -S -u 999 -G webknossos webknossos \
  && mkdir disk \
  && chown -R webknossos .

USER webknossos

ENTRYPOINT [ "bin/oxalis" ]
