#!/bin/bash

set -e

#check for existing environment variables
: ${WORKSPACE:?"Need non empty WORKSPACE variable"}
: ${JOB_NAME:?"Need non empty JOB_NAME variable"}
: ${BUILD_NUMBER:?"Need non empty BUILD_NUMBER variable"}
: ${GIT_BRANCH:?"Need non empty GIT_BRANCH variable"}

export VERSION=$(<${WORKSPACE}/version)

#make project name uppercase
PROJECT="$(tr [a-z] [A-Z] <<< "$JOB_NAME")"
PORTS_PER_PROJECT=2000
BASE_PORT=10000

REAL_BRANCH=$(<${WORKSPACE}/.git/REAL_BRANCH)
cd `dirname $0`
./make_dist.sh ${JOB_NAME} ${REAL_BRANCH} ${BUILD_NUMBER}

let "PORT = BASE_PORT + BUILD_NUMBER % PORTS_PER_PROJECT"

for MODE in "dev" "prod"
do
  for PKG_TYPE in "deb" "rpm"
  do
    ./build-helper.sh ${JOB_NAME} ${REAL_BRANCH} ${BUILD_NUMBER} ${PORT} ${MODE} ${PKG_TYPE}
  done
done
