FROM openjdk:8-jdk
RUN apt-get update \
    && apt-get -y install postgresql-client \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

COPY target/universal/stage .
COPY webknossos-datastore/lib/native target/universal/stage/lib/native


RUN addgroup --system --gid 999 webknossos \
  && adduser --system --uid 999 --ingroup webknossos webknossos \
  && mkdir disk \
  && chown -R webknossos . \
  && chmod go+x bin/webknossos \
  && chmod go+w .

HEALTHCHECK \
  --interval=1m --timeout=5s --retries=10 \
  CMD curl --fail http://localhost:9000/api/buildinfo || exit 1

USER webknossos

EXPOSE 9000

ENTRYPOINT [ "bin/webknossos" ]
