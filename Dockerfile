FROM openjdk:8-jdk
RUN apt-get update \
    && apt-get -y install postgresql-client \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

COPY target/universal/stage .

RUN addgroup --system --gid 999 webknossos \
  && adduser --system --uid 999 --ingroup webknossos webknossos \
  && mkdir disk \
  && chown -R webknossos . \
  && chmod go+x bin/webknossos \
  && chmod go+w .



USER webknossos

ENTRYPOINT [ "bin/webknossos" ]
