#!/usr/bin/env bash
set -Eeuo pipefail

FOSSILDB_HOME="$(dirname "$0")/fossildb"

"$FOSSILDB_HOME/run.sh" > "$FOSSILDB_HOME/logs" &
sbt "$@"
