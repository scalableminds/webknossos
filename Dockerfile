FROM openjdk:8-jre-alpine

RUN apk --no-cache add bash \
  && mkdir -p /srv/webknossos-datastore \
  && adduser -H -D webknossos webknossos \
  && cd /srv/webknossos-datastore \
  && mkdir disk \
  && chown -R webknossos .

WORKDIR /srv/webknossos-datastore

VOLUME /srv/webknossos-datastore/binaryData /srv/webknossos-datastore/userBinaryData 

COPY target/universal/stage .

USER webknossos

ENTRYPOINT ["bin/standalone-datastore"]
CMD ["-J-Xmx20G", "-J-Xms1G", "-Dconfig.file=conf/application.conf", "-Dlogger.file=conf/logback-docker.xml", "-Dhttp.port=9090", "-Dhttp.address=0.0.0.0"]