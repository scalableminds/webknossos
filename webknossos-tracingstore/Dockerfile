FROM openjdk:8-jre

RUN mkdir -p /webknossos-tracingstore \
  && groupadd -g 1000 -r webknossos \
  && useradd -u 1000 -r -g webknossos webknossos \
  && mkdir /webknossos-tracingstore/tracingData

WORKDIR /webknossos-tracingstore

VOLUME /webknossos-tracingstore/tracingData /tmp

COPY target/universal/stage .

RUN chown -R webknossos . \
  && chmod go+x bin/webknossos-tracingstore \
  && chmod go+w .

RUN echo '#!/bin/bash\numask 002\n/bin/bash "$@"\n' > /docker-entrypoint.sh \
  && chmod +x /docker-entrypoint.sh

USER webknossos

HEALTHCHECK \
  --interval=1m --timeout=5s --retries=10 \
  CMD curl --fail http://localhost:9050/tracings/health || exit 1

EXPOSE 9050

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bin/webknossos-tracingstore", "-J-Xmx20G", "-J-Xms1G", "-Dconfig.file=conf/standalone-tracingstore.conf", "-Dlogger.file=conf/logback-docker.xml", "-Dlogback.configurationFile=conf/logback-docker.xml", "-Dhttp.port=9090", "-Dhttp.address=0.0.0.0"]
