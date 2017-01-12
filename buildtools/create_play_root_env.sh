#!/bin/bash
set -ex

cd $WORKSPACE

APP_DIR_PREFIX="${1-.}"
PROJECT=standalone-datastore
BRANCH=$(<${WORKSPACE}/.git/REAL_BRANCH)
NAME=${PROJECT}-${BRANCH}

APP_DIR=${APP_DIR_PREFIX}/target/universal/stage
ROOT_ENV="rootenv"
INSTALL_DIR="/usr/lib/${NAME}"

chmod +x $APP_DIR/bin/${PROJECT}

mkdir -p ${ROOT_ENV}${INSTALL_DIR}
cp -r ${APP_DIR}/* ${ROOT_ENV}${INSTALL_DIR}
