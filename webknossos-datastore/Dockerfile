FROM openjdk:8-jre

RUN mkdir -p /srv/webknossos-datastore \
  && groupadd -g 1000 -r webknossos \
  && useradd -u 1000 -r -g webknossos webknossos

WORKDIR /srv/webknossos-datastore

VOLUME /srv/webknossos-datastore/binaryData /tmp

COPY target/universal/stage .

RUN chown -R webknossos . \
  && chmod go+x bin/webknossos-datastore \
  && chmod go+w .

USER webknossos

ENTRYPOINT ["bin/webknossos-datastore"]
CMD ["-J-Xmx20G", "-J-Xms1G", "-Dconfig.file=conf/standalone-datastore.conf", "-Dlogger.file=conf/logback-docker.xml", "-Dlogback.configurationFile=conf/logback-docker.xml", "-Dhttp.port=9090", "-Dhttp.address=0.0.0.0"]
