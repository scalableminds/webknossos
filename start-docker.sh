#!/usr/bin/env bash
set -Eeuo pipefail

USER_UID=$(id -u) USER_GID=$(id -g) docker-compose up webknossos
