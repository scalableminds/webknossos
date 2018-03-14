#!/usr/bin/env bash
set -Eeuo pipefail

SED=sed
if [ -x "$(command -v gsed)" ]; then
    SED=gsed
fi

url=${POSTGRES_URL:-"jdbc:postgresql://localhost/webknossos"}

echo $url | $SED -r 's#.*\/\/([^/]+).*#\1#'
