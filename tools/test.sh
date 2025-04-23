#!/bin/bash

testBundlePath="public-test/test-bundle"
jsPath="frontend/javascripts"
proto_dir="webknossos-datastore/proto"
FIND=find

if [ -x "$(command -v gfind)" ]; then
    FIND=gfind
fi

cmd=$1
shift;

# Create test-bundle dir if it does not exist
mkdir -p "$testBundlePath"

function prepare {
  rm -rf "$testBundlePath" && mkdir "$testBundlePath"
  # Webpack with the proto loader isn't used when running the tests, so the proto files need to be prepared manually
  for proto_file in "$proto_dir"/*.proto; do
      output_file="$testBundlePath/$(basename "$proto_file").json"
      pbjs -t json "$proto_file" > "$output_file"
  done

  # Beginning from target==node13, dynamic imports are not converted anymore by esbuild. Tests which use code
  # that relies on dynamic imports fails then because the module cannot be found for some reason.
  node_modules/.bin/esbuild \
    --platform=node \
    --format=cjs \
    --define:process.env.IS_TESTING=\"true\" \
    --target=node12 \
    --log-level=error \
    --outdir="$testBundlePath" $($FIND frontend/javascripts \( -name "*.ts" -o -name "*.tsx" \))

  # Copy files which were not compiled by esbuild (e.g., snapshots).
  find frontend/javascripts -type f -not \( -name "*.ts" -o -name "*.tsx" -o -name "*.png" \) -exec sh -c '
    testBundlePath="public-test/test-bundle"
    file="$1"                # E.g., frontend/javascripts/test/snapshots/public-test/test-bundle/test/libs/nml.spec.js.snap
    from="$file"
    to="$file"
    to=${to#*/}              # Remove everything until (and including) the first / to trim the first folder. E.g., javascripts/test/snapshots/public-test/test-bundle/test/libs/nml.spec.js.snap
    to=${to#*/}              # Also remove the second folder. E.g., test/snapshots/public-test/test-bundle/test/libs/nml.spec.js.snap
    to="$testBundlePath/$to" # Add new bundle path as parent. E.g. public-test/test-bundle/test/snapshots/public-test/test-bundle/test/libs/nml.spec.js.snap
    to_dir=${to%/*}          # Remove the file name from the path in $to. E.g., public-test/test-bundle/test/snapshots/public-test/test-bundle/test/libs
    # Only copy when src and dst differ
    cmp --silent $from $to && echo skip $from to $to
    cmp --silent $from $to || mkdir -p $to_dir && cp $from $to
  ' find-sh {} \;
}

ensureUpToDateTests() {
  lastChangedSource=$($FIND "$jsPath" -regex ".*\.tsx?$" -type f -printf '%T@ %p \n' | sort -n | tail -1 | awk -F'.' '{print $1}')
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

if [ $cmd == "test-e2e" ]
then
  ensureUpToDateTests
  export NODE_PATH="$testBundlePath" && ava $(find "$testBundlePath" -name "*.e2e.js") --serial -C 1 "$@"
elif [ $cmd == "test-screenshot" ]
then
  ensureUpToDateTests
  export NODE_PATH="$testBundlePath" && ava $(find "$testBundlePath" -name "*.screenshot.js") "$@"
elif [ $cmd == "test-wkorg-screenshot" ]
then
  ensureUpToDateTests
  export NODE_PATH="$testBundlePath" && ava $(find "$testBundlePath" -name "*.wkorg_screenshot.js") "$@"
elif [ $cmd == "prepare" ]
then
  prepare "$@"
else
  echo "Unknown command"
fi
