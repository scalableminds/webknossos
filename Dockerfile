FROM scalableminds/various:alpine__master__62

RUN apk --no-cache add bash openjdk8-jre 'postgresql-client~10'
RUN apk --no-cache add --repository http://dl-cdn.alpinelinux.org/alpine/edge/testing 'grpc-java~1.11'

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

COPY target/universal/stage .

RUN addgroup -S -g 999 webknossos \
  && adduser -S -u 999 -G webknossos webknossos \
  && mkdir disk \
  && chown -R webknossos .

USER webknossos

ENTRYPOINT [ "bin/oxalis" ]
