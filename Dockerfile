FROM scalableminds/graalvm:master__56

RUN apk --no-cache add bash 'postgresql-client~10'

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

COPY target/universal/stage .

RUN addgroup -S -g 999 webknossos \
  && adduser -S -u 999 -G webknossos webknossos \
  && mkdir disk \
  && chown -R webknossos .

USER webknossos

ENTRYPOINT [ "bin/oxalis" ]
