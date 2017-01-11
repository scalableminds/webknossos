#!/bin/bash

set -e

: ${JENKINS_HOME:?"Need non empty JENKINS_HOME variable"}
: ${JOB_NAME:?"Need non empty JOB_NAME variable"}
: ${BUILD_NUMBER:?"Need non empty BUILD_NUMBER variable"}
: ${BUILD_ID:?"Need non empty BUILD_ID variable"}


cd ${WORKSPACE}/packages
PKGS=$(ls -Qm | tr -d [:cntrl:])

sudo salt-call event.fire_master "{'jenkins_home': \"${JENKINS_HOME}\", 'build_id': \"${BUILD_ID}\", 'packages': [${PKGS}], 'project': \"${JOB_NAME}\", 'branch': \"${BRANCH_NAME}\",  'build_number': \"${BUILD_NUMBER}\"}" "successful-build"
