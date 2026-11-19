#!/usr/bin/env bash
# Local dev: the Rust datastore on :9090, in place of the Scala standalone datastore.
# Run the application backend with tools/dev-rust.sh (:9001), the tracingstore with
# tools/dev-stores.sh and the frontend with `yarn dev` (vite on :9000).
#
# Usage (from anywhere):  backend-rust/tools/dev-datastore.sh [--release]
#   --release  build and run the optimized binary (faster data reads, slower build)
#
# The defaults match standalone-datastore.conf (name standalone-9090, its key, port 9090,
# ./binaryData relative to the repository root), so the database registration from
# "Point the database at the standalone stores" in backend-rust/README.md works unchanged.
# Requires: Redis running. Personal overrides (WK_DS_*, see datastore/.env.example) go into
# backend-rust/datastore/.env (gitignored, sourced if present).
set -Eeuo pipefail

BACKEND_RUST="$(cd "$(dirname "$0")/.." && pwd)"
# Like the Scala store, run from the repository root so relative base directories match.
cd "$BACKEND_RUST/.."

PROFILE=debug
CARGO_PROFILE_ARGS=()
if [[ "${1:-}" == "--release" ]]; then
  PROFILE=release
  CARGO_PROFILE_ARGS=(--release)
fi

# Talk to the Rust backend directly instead of through vite, like tools/dev-stores.sh.
export WK_DS_WEBKNOSSOS_URI="${WK_DS_WEBKNOSSOS_URI:-http://localhost:9001}"
export RUST_LOG="${RUST_LOG:-info}"
if [[ -f "$BACKEND_RUST/datastore/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$BACKEND_RUST/datastore/.env"
  set +a
fi

PORT="${WK_DS_HTTP_PORT:-9090}"
if lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  echo "Port $PORT is already in use (the Scala datastore?):" >&2
  lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n >&2
  exit 1
fi
redis-cli ping >/dev/null 2>&1 || { echo "Redis is not running (brew services start redis)" >&2; exit 1; }

cargo build --locked --manifest-path "$BACKEND_RUST/Cargo.toml" -p webknossos-datastore \
  ${CARGO_PROFILE_ARGS[@]+"${CARGO_PROFILE_ARGS[@]}"}

# The datastore registers with the application at startup and only re-reports every 10 minutes,
# so wait for it.
until curl -sf -o /dev/null "$WK_DS_WEBKNOSSOS_URI/api/health"; do
  echo "Waiting for the application backend at $WK_DS_WEBKNOSSOS_URI ..."
  sleep 2
done

exec "$BACKEND_RUST/target/$PROFILE/webknossos-datastore"
