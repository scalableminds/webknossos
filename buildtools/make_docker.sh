#!/bin/bash

set -eu

#check for existing environment variables
: ${WORKSPACE:?"Need non-empty WORKSPACE variable"}

if [ $# -lt 4 ]; then
echo "Usage: $0 <project> <branch> <commit> <iteration> "
  exit 1
fi

export SBT_VERSION_TAG=sbt-0.13.9_mongo-3.2.1_node-7.x_jdk-8

PROJECT=${1}
BRANCH=${2}
COMMIT=${3}
ITERATION=${4}

pushd ${WORKSPACE}

# PRE
function cleanup {
  docker-compose down || echo "Can not run docker-compose down"
  docker logout || echo "Can not run docker logout"
  popd
}

trap cleanup EXIT

# PRE
docker login -u $DOCKER_USER -p $DOCKER_PASS
docker pull scalableminds/sbt:$SBT_VERSION_TAG

# BUILD
docker-compose run oxalis-sbt clean compile stage
docker build -t scalableminds/oxalis:$ITERATION .

# RUN TEST
docker-compose run oxalis-frontend-tests
docker-compose run oxalis-e2e-tests

# DOCKER SMOKE TEST
DOCKER_TAG=$ITERATION docker-compose up oxalis &
sleep 10
./test/infrastructure/deployment.bash
docker-compose down

# PUBLISH
docker tag scalableminds/oxalis:$ITERATION scalableminds/oxalis:branch-$BRANCH
docker tag scalableminds/oxalis:$ITERATION scalableminds/oxalis:commit-$COMMIT
docker push scalableminds/oxalis:$ITERATION
docker push scalableminds/oxalis:branch-$BRANCH
docker push scalableminds/oxalis:commit-$COMMIT

