#!/bin/bash

testBundlePath="public/test-bundle"
jsPath="app/assets/javascripts"
FIND=find

if [ -x "$(command -v gfind)" ]; then
    FIND=gfind
fi

cmd=$1
shift;
additionalParams=$@

function prepare {
  rm -rf "$testBundlePath" && BABEL_ENV=test babel "$jsPath" --out-dir "$testBundlePath" $additionalParams
}

function ensureUpToDateTests {
  lastChangedSource=$($FIND "$jsPath" -regex ".*\.js$" -type f -printf '%T@ %p \n' | sort -n | tail -1 | awk -F'.' '{print $1}')
  lastChangedTests=$($FIND "$testBundlePath" -type f -printf '%T@ %p \n' | sort -n | tail -1 | awk -F'.' '{print $1}')

  if [ $lastChangedSource -gt $lastChangedTests ]
  then
    YELLOW='\e[33m'
    NC='\033[0m' # No Color
    echo ""
    echo -e "${YELLOW}Running test-prepare as the source files seem to be newer than the compiled ones.${NC}"
    echo ""
    prepare
  fi
}

if [ $cmd == "test" ]
then
  ensureUpToDateTests
  export NODE_PATH="$testBundlePath" && BABEL_ENV=test ava $(find "$testBundlePath" -name "*.spec.js") "$@"
elif [ $cmd == "test-e2e" ]
then
  ensureUpToDateTests
  export NODE_PATH="$testBundlePath" && BABEL_ENV=test ava $(find "$testBundlePath" -name "snapshot.e2e.js") --serial "$@"
elif [ $cmd == "prepare" ]
then
  prepare "$@"
else
  echo "Unknown command"
fi
