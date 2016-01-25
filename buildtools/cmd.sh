#!/bin/bash
set -e

INSTALL_DIR=$(pwd)
APPLICATION_CONFIG=${INSTALL_DIR}/conf/application.conf
PORT=${PORT:-9000}
LOGGER_XML=${LOGGER_XML:-${INSTALL_DIR}/conf/application-logger.xml}
MONGO_DB=${MONGO_DB:-oxalis}

exec bin/oxalis -Dconfig.file=${APPLICATION_CONFIG} -Dhttp.port=${PORT} -Djava.io.tmpdir=disk -Dmongodb.db=${MONGO_DB} -Dmongodb.url=${MONGO_PORT_27017_TCP_ADDR} -Dmongodb.port=${MONGO_PORT_27017_TCP_PORT}
