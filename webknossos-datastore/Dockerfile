FROM openjdk:8-jre

RUN mkdir -p /srv/webknossos-datastore \
  && groupadd -g 1000 -r webknossos \
  && useradd -u 1000 -r -g webknossos webknossos \
  && cd /srv/webknossos-datastore \
  && mkdir tracingData \
  && chown -R webknossos .

WORKDIR /srv/webknossos-datastore

VOLUME /srv/webknossos-datastore/binaryData /srv/webknossos-datastore/tracingData /tmp

COPY target/universal/stage .

USER webknossos

ENTRYPOINT ["bin/standalone-datastore"]
CMD ["-J-Xmx20G", "-J-Xms1G", "-Dconfig.file=conf/application.conf", "-Dlogger.file=conf/logback-docker.xml", "-Dlogback.configurationFile=conf/logback-docker.xml", "-Dhttp.port=9090", "-Dhttp.address=0.0.0.0"]
