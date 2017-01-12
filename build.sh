#!/bin/bash
set -ex
${HELPER_DIR}/correctBranch.sh
export BRANCH=$(<${WORKSPACE}/.git/REAL_BRANCH)

PROJECT=standalone-datastore
BRANCH=$(<${WORKSPACE}/.git/REAL_BRANCH)
NAME=${PROJECT}-${BRANCH}
MODE=prod
#VERSION=$BRAINGAMES_LIB_VERSION
VERSION=10.0.0
TEMPLATE_DIR=${WORKSPACE}/buildtools/templates

cd $WORKSPACE

sbt clean compile stage

buildtools/create_play_root_env.sh

ROOT_ENV="rootenv"
INSTALL_DIR="/usr/lib/${NAME}"

NEWRELIC_CONFIG_PATH="${ROOT_ENV}/${INSTALL_DIR}/conf/newrelic.yml"
NEWRELIC_TEMPLATE=$(< ${TEMPLATE_DIR}/newrelic_template)
NEWRELIC_AGENT_VERSION=$(ls target/universal/stage/lib | python2.7 -c \
  "import re, sys; print re.search('com\.newrelic\.agent\.java\.newrelic-agent-(\d+\.\d+\.\d+)', sys.stdin.read()).group(1)")
mkdir -p ${ROOT_ENV}/${INSTALL_DIR}/conf
python2.7 -c "import jinja2; print jinja2.Template(\"\"\"$NEWRELIC_TEMPLATE\"\"\").render(\
project=\"$PROJECT\", branch=\"$BRANCH\", newrelic_license_key=\"$NEWRELIC_LICENSE_KEY\", mode=\"$MODE\")" > $NEWRELIC_CONFIG_PATH




fpm -m thomas@scm.io -s dir -t rpm \
  -n ${NAME} \
  -v $VERSION \
  --iteration ${BUILD_NUMBER} \
  --provides ${NAME} \
  --template-scripts \
  --template-value project="${PROJECT}" \
  --template-value branch="${BRANCH}" \
  -C rootenv usr/

fpm -m thomas@scm.io -s dir -t deb \
  -n ${NAME} \
  -v $VERSION \
  --iteration ${BUILD_NUMBER} \
  --provides ${NAME} \
  --template-scripts \
  --template-value project="${PROJECT}" \
  --template-value branch="${BRANCH}" \
  -C rootenv usr/
