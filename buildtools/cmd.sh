#!/bin/bash
set -e

INSTALL_DIR=$(pwd)
APPLICATION_CONFIG=${INSTALL_DIR}/conf/application_${MODE:-dev}.conf
PORT=${PORT:-9000}
LOGGER_XML=${LOGGER_XML:-${INSTALL_DIR}/conf/application-logger.xml}
MONGO_DB=${MONGO_DB:-oxalis}

ARGS="\
  -Dconfig.file=${APPLICATION_CONFIG} -Dhttp.address=\"0.0.0.0\" -Dhttp.port=${PORT} \
  -Djava.io.tmpdir=disk \
  -Dmongodb.db=${MONGO_DB} -Dmongodb.url=mongo -Dmongodb.port=27017 \
  -Dmongodb.uri=\"mongodb://mongo:27017/${MONGO_DB}\""

if [[ "$NEW_RELIC_LICENSE_KEY" ]]; then
  NEWRELIC_AGENT_JAR=$(ls ${INSTALL_DIR}/lib | grep com.newrelic.agent.java.newrelic-agent)
  ARGS="${ARGS}\
    -J-javaagent:${INSTALL_DIR}/lib/${NEWRELIC_AGENT_JAR} \
    -J-Dnewrelic.config.file=${INSTALL_DIR}/conf/newrelic.yml"
fi

echo bin/oxalis ${ARGS}

exec bin/oxalis ${ARGS}

