#!/bin/bash
set -e

INSTALL_DIR=$(pwd)
APPLICATION_CONFIG=${INSTALL_DIR}/conf/application_${MODE:-dev}.conf
PORT=${PORT:-9000}
LOGGER_XML=${LOGGER_XML:-${INSTALL_DIR}/conf/application-logger.xml}
MONGO_DB=${MONGO_DB:-oxalis}

echo bin/oxalis \
  -Dconfig.file=${APPLICATION_CONFIG} -Dhttp.address="0.0.0.0" -Dhttp.port=${PORT} \
  -Djava.io.tmpdir=disk \
  -Dmongodb.db=${MONGO_DB} -Dmongodb.url=mongo -Dmongodb.port=27017 \
  -Dmongodb.uri="mongodb://mongo:27017/${MONGO_DB}"

exec bin/oxalis \
  -Dconfig.file=${APPLICATION_CONFIG} -Dhttp.address="0.0.0.0" -Dhttp.port=${PORT} \
  -Djava.io.tmpdir=disk \
  -Dmongodb.db=${MONGO_DB} -Dmongodb.url=mongo -Dmongodb.port=27017 \
  -Dmongodb.uri="mongodb://mongo:27017/${MONGO_DB}"

