#!/usr/bin/env bash
set -Eeuo pipefail

if [ "${GITHUB_REF}" == "master" ]; then
  echo "Skipping this step on master..."
else
  exec "$@"
fi
