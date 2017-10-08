#!/bin/bash

testBundlePath="public/test-bundle"
jsPath="app/assets/javascripts"
FIND=find

if [ -x "$(command -v gfind)" ]; then
    FIND=gfind
fi

cmd=$1
shift;

function ensureUpToDateTests {
	lastChangedSource=$($FIND $jsPath -regex ".*\.js$" -type f -printf '%T@ %p \n' | sort -n | tail -1 | awk -F'.' '{print $1}')
	lastChangedTests=$($FIND $testBundlePath -type f -printf '%T@ %p \n' | sort -n | tail -1 | awk -F'.' '{print $1}')

	if [ $lastChangedSource -gt $lastChangedTests ]
	then
		echo "Please run yarn test-prepare. The source files seem to be newer than the compiled ones."
		exit 1
	fi
}

if [ $cmd == "test" ]
then
  ensureUpToDateTests
	export NODE_PATH=$testBundlePath && BABEL_ENV=test ava $(find $testBundlePath -name "*.spec.js") "$@"
elif [ $cmd == "test-e2e" ]
then
  ensureUpToDateTests
  export NODE_PATH=$testBundlePath && BABEL_ENV=test ava $(find $testBundlePath -name "*.e2e.js") "$@"
elif [ $cmd == "prepare" ]
then
	rm -rf $testBundlePath && BABEL_ENV=test babel $jsPath --out-dir $testBundlePath "$@"
else
	echo "Unknown command"
fi
