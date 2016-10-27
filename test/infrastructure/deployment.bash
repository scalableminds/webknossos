#!/usr/bin/env bash

source "$(dirname "$0")/helper.bash"

run_test "curl localhost:9000" curl -m 10 --retry 20 --retry-delay 5 -v http://localhost:9000
