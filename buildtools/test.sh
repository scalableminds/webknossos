#!/bin/bash

# For some reason this is necessary so that ava picks up the right files
cd public

testBundlePath="./test-bundle"
jsPath="../app/assets/javascripts"

cmd=$1
shift;

if [ $cmd == "test" ]
then
	lastChangedSource=$(find $jsPath -type f -printf '%T@ %p \n' | sort -n | tail -1 | awk -F'.' '{print $1}')
	lastChangedTests=$(find $testBundlePath -type f -printf '%T@ %p \n' | sort -n | tail -1 | awk -F'.' '{print $1}')

	if [ $lastChangedSource -gt $lastChangedTests ]
	then
		echo "Please run yarn test-prepare. The source files seem to be newer than the compiled ones."
		exit 1
	fi
	
	export NODE_PATH=$testBundlePath && BABEL_ENV=test ava $testBundlePath/test/**/*.spec.js -c 8 "$@"
elif [ $cmd == "prepare" ]
then
	rm -rf $testBundlePath && BABEL_ENV=test babel $jsPath --out-dir $testBundlePath "$@"
else
	echo "Unknown command"
fi
