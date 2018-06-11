#!/usr/bin/env bash

source "$(dirname "$0")/helper.bash"

run_test "curl localhost:9000" retry 20 5 curl -v --fail -I http://localhost:9000
