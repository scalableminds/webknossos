#!/bin/bash

testBundlePath="public/test-bundle"
jsPath="frontend/javascripts"
FIND=find

if [ -x "$(command -v gfind)" ]; then
    FIND=gfind
fi

cmd=$1
shift;
additionalParams=$@

# Create test-bundle dir if it does not exist
mkdir -p "$testBundlePath"

function prepare {
  rm -rf "$testBundlePath" && mkdir "$testBundlePath"
  # Webpack with the proto loader isn't used when running the tests, so the proto files need to be prepared manually
  pbjs -t json "webknossos-datastore/proto/SkeletonTracing.proto" > "$testBundlePath/SkeletonTracing.proto.json"
  pbjs -t json "webknossos-datastore/proto/VolumeTracing.proto" > "$testBundlePath/VolumeTracing.proto.json"
  # --copy-files will copy files that are present in the source dir but are not transpiled (e.g.: json files)
  BABEL_ENV=test babel "$jsPath" --out-dir "$testBundlePath" --copy-files $additionalParams
}

function ensureUpToDateTests {
  lastChangedSource=$($FIND "$jsPath" -regex ".*\.js$" -type f -printf '%T@ %p \n' | sort -n | tail -1 | awk -F'.' '{print $1}')
  lastChangedTests=$($FIND "$testBundlePath" -type f -printf '%T@ %p \n' | sort -n | tail -1 | awk -F'.' '{print $1}')

  if [ ! $lastChangedTests ] || [ $lastChangedSource -gt $lastChangedTests ]
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
  # export NODE_PATH="$testBundlePath" && BABEL_ENV=test nyc --silent --no-clean --exclude binaryData ava $(find "$testBundlePath" -name "volumetracing_saga_integration.spec.js") "$@"

  export NODE_PATH="$testBundlePath" && BABEL_ENV=test ava $(find "$testBundlePath" -name "volumetracing_saga_integration.spec.js") "$@"
elif [ $cmd == "test-debug" ]
then
  export NODE_PATH="$testBundlePath" && BABEL_ENV=test ava debug --inspect $(find "$testBundlePath" -name "volumetracing_saga_integration.spec.js") "$@"
elif [ $cmd == "test-e2e" ]
then
  ensureUpToDateTests
  # export NODE_PATH="$testBundlePath" && BABEL_ENV=test nyc --silent --no-clean ava $(find "$testBundlePath" -name "*.e2e.js") --serial -C 1 "$@"
elif [ $cmd == "test-screenshot" ]
then
  ensureUpToDateTests
  export NODE_PATH="$testBundlePath" && BABEL_ENV=test ava $(find "$testBundlePath" -name "*.screenshot.js") "$@"
elif [ $cmd == "prepare" ]
then
  prepare "$@"
else
  echo "Unknown command"
fi
