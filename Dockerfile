FROM scalableminds/graalvm:master__49

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

COPY target/universal/stage .

RUN apk --no-cache add bash 'postgresql-client~10' shadow \
  && groupadd -r webknossos \
  && useradd -r -g webknossos webknossos \
  && mkdir disk \
  && chown -R webknossos .

USER webknossos

ENTRYPOINT [ "bin/oxalis" ]
