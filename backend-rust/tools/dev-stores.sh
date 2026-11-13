#!/usr/bin/env bash
# Local dev: Scala standalone tracingstore (:9050), plus FossilDB if not running.
# The datastore is the Rust one: tools/dev-datastore.sh (:9090).
# Ctrl-C stops both (concurrently kills all process trees).
# The tracingstore registers with the application backend on :9001 (tools/dev-rust.sh) and waits for it.
#
# Usage (from anywhere):  backend-rust/tools/dev-stores.sh [--no-build]
#   --no-build  skip `sbt stage` and run the previously staged tracingstore
#
# Requires: Redis running; the database must have the standalone stores registered
# (see "Point the database at the standalone stores" in backend-rust/README.md).
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:$PATH" # Node >= 22 for concurrently

BUILD=1
[[ "${1:-}" == "--no-build" ]] && BUILD=0

port_in_use() { lsof -iTCP:"$1" -sTCP:LISTEN -P -n >/dev/null 2>&1; }

if port_in_use 9050; then
  echo "Port 9050 is already in use (another tracingstore?):" >&2
  lsof -iTCP:9050 -sTCP:LISTEN -P -n >&2
  exit 1
fi
redis-cli ping >/dev/null 2>&1 || { echo "Redis is not running (brew services start redis)" >&2; exit 1; }

TS_BIN="webknossos-tracingstore/target/universal/stage/bin/webknossos-tracingstore"
if [[ $BUILD == 1 || ! -x $TS_BIN ]]; then
  sbt "webknossosTracingstore/stage"
fi

# The tracingstore registers with the application at startup, so wait for it. It talks to the Rust
# backend directly instead of through vite (its standalone config points at :9000).
APP_URI="http://localhost:9001"
WAIT_FOR_APP="until curl -sf -o /dev/null $APP_URI/api/health; do sleep 2; done;"
STORE_JVM_OPTS="-J-Xmx8G -Dpidfile.path=/dev/null"

NAMES="tracingstore"
COMMANDS=(
  "$WAIT_FOR_APP exec $TS_BIN $STORE_JVM_OPTS -Dconfig.resource=standalone-tracingstore.conf -Dhttp.port=9050 -Dtracingstore.webKnossos.uri=$APP_URI"
)
if port_in_use 7155; then
  echo "FossilDB already running on :7155, reusing it."
else
  NAMES="$NAMES,fossildb"
  COMMANDS+=("fossildb/run.sh")
fi

exec node_modules/.bin/concurrently --kill-others --names "$NAMES" \
  --prefix-colors "blue,green" "${COMMANDS[@]}"
