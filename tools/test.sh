#!/bin/bash

testBundlePath="public-test/test-bundle"
jsPath="frontend/javascripts"
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
  pbjs -t json "webknossos-datastore/proto/SkeletonTracing.proto" > "$testBundlePath/SkeletonTracing.proto.json"
  pbjs -t json "webknossos-datastore/proto/VolumeTracing.proto" > "$testBundlePath/VolumeTracing.proto.json"

  node_modules/.bin/esbuild \
    --platform=node \
    --format=cjs \
    --define:process.env.BABEL_ENV=\"test\" \
    --target=node10.4 \
    --outdir="$testBundlePath" $($FIND frontend/javascripts \( -name "*.ts" -o -name "*.tsx" \))

  # Copy files which were not compiled by esbuild (e.g., snapshots).
  find frontend/javascripts -type f -not \( -name "*.ts" -o -name "*.tsx" -o -name "*.png" \) -exec sh -c '
    testBundlePath="public-test/test-bundle"
    file="$1"
    from="$file"
    to="$file"
    to=${to#*/}              # Remove everything until (and including) the first / to trim the first folder
    to=${to#*/}              # Also remove the second folder
    to="$testBundlePath/$to" # Add new bundle path as parent
    to_dir=${to%/*}          # Remove the file name from the path in $to
    # Only copy when src and dst differ
    cmp --silent $from $to && echo skip $from to $to
    cmp --silent $from $to || mkdir -p $to_dir && cp $from $to
  ' find-sh {} \;
}

function ensureUpToDateTests {
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

# For faster, local testing, you may want to remove the `c8` part of the following statement.
# Also, removing `istanbul` from .babelrc, allows to debug uninstrumented source code.
if [ $cmd == "test" ]
then
  ensureUpToDateTests
  export NODE_PATH="$testBundlePath" && c8 --silent --no-clean --exclude binaryData ava $(find "$testBundlePath" -name "*.spec.js") "$@"
elif [ $cmd == "test-debug" ]
then
  export NODE_PATH="$testBundlePath" && ava debug $(find "$testBundlePath" -name "*.spec.js") "$@"
elif [ $cmd == "test-changed" ]
then
  ensureUpToDateTests
  # Find modified *.spec.* files, trim their extension (since ts != js) and look them up in the compiled bundle
  changed_files=$(git ls-files --modified | grep \.spec\. | xargs -i basename {} | sed -r 's|^(.*?)\.\w+$|\1|' | xargs -i find public-test/test-bundle -name "{}*")
  echo Only running $changed_files
  export NODE_PATH="$testBundlePath" && c8 --silent --no-clean --exclude binaryData ava \
    $changed_files \
    "$@"
elif [ $cmd == "test-e2e" ]
then
  ensureUpToDateTests
  export NODE_PATH="$testBundlePath" && c8 --silent --no-clean ava $(find "$testBundlePath" -name "*.e2e.js") --serial -C 1 "$@"
elif [ $cmd == "test-screenshot" ]
then
  ensureUpToDateTests
  export NODE_PATH="$testBundlePath" && ava $(find "$testBundlePath" -name "*.screenshot.js") "$@"
elif [ $cmd == "prepare" ]
then
  prepare "$@"
else
  echo "Unknown command"
fi
