#!/usr/bin/env bash
set -Eeuo pipefail

trap "trap - SIGTERM && kill -- -$$" SIGINT SIGTERM EXIT

FOSSILDB_HOME="$(dirname "$0")/fossildb"

"$FOSSILDB_HOME/run.sh" > "$FOSSILDB_HOME/logs" &
exec sbt "$@"
