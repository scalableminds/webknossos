#!/usr/bin/env bash
set -Eeuo pipefail

url=${POSTGRES_URL:-"jdbc:postgresql://localhost/webknossos"}

echo $url | sed -r 's#.*\/\/([^/]+).*#\1#'
