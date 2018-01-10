FROM openjdk:8-jdk

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

COPY target/universal/stage .

RUN groupadd -r webknossos \
  && useradd -r -g webknossos webknossos \
  && mkdir disk \
  && chown -R webknossos .

USER webknossos

ENTRYPOINT [ "bin/oxalis" ]
