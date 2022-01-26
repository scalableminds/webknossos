FROM openjdk:8-jre

RUN mkdir -p /webknossos-datastore \
  && groupadd -g 1000 -r webknossos \
  && useradd -u 1000 -r -g webknossos webknossos

WORKDIR /webknossos-datastore

VOLUME /webknossos-datastore/binaryData /tmp

COPY target/universal/stage .

RUN chown -R webknossos . \
  && chmod go+x bin/webknossos-datastore \
  && chmod go+w .

RUN echo '#!/bin/bash\numask 002\nbin/webknossos-datastore "$@"\n' > /docker-entrypoint.sh \
  && chmod +x /docker-entrypoint.sh

USER webknossos

HEALTHCHECK \
  --interval=1m --timeout=5s --retries=10 \
  CMD curl --fail http://localhost:9090/data/health || exit 1

EXPOSE 9090

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["-J-Xmx20G", "-J-Xms1G", "-Dconfig.file=conf/standalone-datastore.conf", "-Dlogger.file=conf/logback-docker.xml", "-Dlogback.configurationFile=conf/logback-docker.xml", "-Dhttp.port=9090", "-Dhttp.address=0.0.0.0"]
