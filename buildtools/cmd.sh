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
  -Dmongodb.db=${MONGO_DB} -Dmongodb.url=${MONGO_PORT_27017_TCP_ADDR} -Dmongodb.port=${MONGO_PORT_27017_TCP_PORT} \
  -Dmongodb.uri="mongodb://${MONGO_PORT_27017_TCP_ADDR}:${MONGO_PORT_27017_TCP_PORT}/${MONGO_DB}"

exec bin/oxalis \
  -Dconfig.file=${APPLICATION_CONFIG} -Dhttp.address="0.0.0.0" -Dhttp.port=${PORT} \
  -Djava.io.tmpdir=disk \
  -Dmongodb.db=${MONGO_DB} -Dmongodb.url=${MONGO_PORT_27017_TCP_ADDR} -Dmongodb.port=${MONGO_PORT_27017_TCP_PORT} \
  -Dmongodb.uri="mongodb://${MONGO_PORT_27017_TCP_ADDR}:${MONGO_PORT_27017_TCP_PORT}/${MONGO_DB}"

