#!/bin/bash

: ${GIT_BRANCH:?"Need non empty GIT_BRANCH variable"}
: ${JOB_NAME:?"Need non empty JOB_NAME variable"}
: ${WORKSPACE:?"Need non empty WORKSPACE variable"}

BARE_BRANCH=${GIT_BRANCH#*/}

function findBranch {
  GITHUB_HEAD="$1"
  if [ BARE_BRANCH == "HEAD" ];then
    echo "$GITHUB_HEAD" | tr "A-Z" "a-z"
  else
    echo "$BARE_BRANCH" | tr "A-Z" "a-z"
  fi
}

case "$JOB_NAME" in
  oxalis)
    REAL_BRANCH=$(findBranch dev)
  ;;
  stackrenderer|director|levelcreator|standalone-datastore)
    REAL_BRANCH=$(findBranch master)
  ;;
  *)
    echo "Unsupported project! aborting ..."
    exit 1
  ;;
esac

echo ${REAL_BRANCH} > ${WORKSPACE}/.git/REAL_BRANCH