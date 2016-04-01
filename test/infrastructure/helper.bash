#!/usr/bin/env bash

function run_test() {
  "${@:2}" &> /dev/null
  rc=$?
  if (exit $rc); then
      echo "test \"$1\" successful"
      return 0
  fi
  echo "test \"$1\" failed with exit code $rc"
  echo "  command: ${@:2}"
  return $rc
}

function retry() {
	for run in $(seq 1 $1); do
    "${@:3}"
    rc=$?
    if (exit $rc); then
      break
    fi
    sleep $2
  done
  return $rc
}
