FROM java:8-jre

ENV PROJECT "standalone-datastore"
ENV INSTALL_DIR /srv/webknossos-datastore
ENV PORT 9000
ENV HOST "https://datastore1.webknossos.io"
ENV MODE prod
ENV LOGGER_XML ${INSTALL_DIR}/conf/application-logger.xml
ENV NEWRELIC_AGENT_VERSION 3.31.1

RUN mkdir -p "$INSTALL_DIR"
WORKDIR "$INSTALL_DIR"

VOLUME /srv/webknossos-datastore/binaryData /srv/webknossos-datastore/userBinaryData 

COPY target/universal/stage .

RUN groupadd -r app-user \
  && useradd -r -g app-user app-user \
  && mkdir disk \
  && chown -R app-user .

USER app-user

ENTRYPOINT /bin/bash -c "${INSTALL_DIR}/bin/standalone-datastore -J-Xmx20G -J-Xms1G -J-javaagent:${INSTALL_DIR}/lib/com.newrelic.agent.java.newrelic-agent-$NEWRELIC_AGENT_VERSION.jar -J-Dnewrelic.config.file=${INSTALL_DIR}/conf/newrelic.yml -Dconfig.file=${INSTALL_DIR}/conf/application.conf -Dhttp.port=$PORT -Dhttp.uri=$HOST -Dlogger.file=${INSTALL_DIR}/conf/application-logger.xml $FLAGS"
