#!/usr/bin/env bash
set -Eeuo pipefail

mkdir -p binaryData

USER_UID=$(id -u) USER_GID=$(id -g) docker compose up webknossos
