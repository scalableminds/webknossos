#!/usr/bin/env bash
set -Eeuo pipefail

trap 'exit $rv' INT TERM
trap 'rv=$?; kill 0' EXIT

FOSSILDB_HOME="$(dirname "$0")/fossildb"

"$FOSSILDB_HOME/run.sh" > "$FOSSILDB_HOME/logs" &
sbt "$@"
