#!/usr/bin/env bash
set -Eeuo pipefail

FOSSILDB_HOME="$(dirname $(readlink $0))/fossildb"

"$FOSSILDB_HOME/run.sh" > "$FOSSILDB_HOME/logs" &
exec sbt "$@"
