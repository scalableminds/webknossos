#!/usr/bin/env bash
# Local dev: the Rust application backend on :9001.
# Run the Scala stores with tools/dev-stores.sh and the frontend with `yarn dev` (vite on :9000).
#
# Usage (from anywhere):  backend-rust/tools/dev-rust.sh [extra cargo run args]
#
# Requires: PostgreSQL running with the standalone stores registered (see "Point the database at
# the standalone stores" in backend-rust/README.md).
# Personal overrides go into backend-rust/.env (gitignored, sourced if present).
set -Eeuo pipefail

cd "$(dirname "$0")/.."

if lsof -iTCP:9001 -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  echo "Port 9001 is already in use (Play or another backend?):" >&2
  lsof -iTCP:9001 -sTCP:LISTEN -P -n >&2
  exit 1
fi

export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/webknossos}"
export WK_PUBLIC_URL="${WK_PUBLIC_URL:-http://localhost:9000}"
# Play's silhouette signer secret, so Play and Rust sessions are interchangeable.
PLAY_SIGNER_SECRET='`?IVa2TCaZAZ4TY]B0=tCs9mJdyaA0V<mA4k[sq6gV=2C5y?liAhWF?ZMA0h1EIe'
DEFAULT_FEATURES='{"voxelyticsEnabled":true}'
export WK_COOKIE_SIGNER_SECRET="${WK_COOKIE_SIGNER_SECRET:-$PLAY_SIGNER_SECRET}"
export WK_FEATURES_JSON="${WK_FEATURES_JSON:-$DEFAULT_FEATURES}"
export LOG_FORMAT="${LOG_FORMAT:-pretty}"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

exec cargo run --locked "$@"
