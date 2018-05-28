FROM openjdk:8-jdk
RUN apt-get update \
    && apt-get -y install postgresql-client pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

COPY target/universal/stage .

RUN groupadd -r webknossos \
  && useradd -r -g webknossos webknossos \
  && mkdir disk \
  && chown -R webknossos .

USER webknossos

ENTRYPOINT [ "bin/oxalis" ]
