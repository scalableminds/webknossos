#!/usr/bin/env bash
set -Eeuo pipefail

$(dirname "$0")/drop_db.sh || true

$(dirname "$0")/ensure_db.sh
