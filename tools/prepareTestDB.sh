#!/bin/bash

set -Eeuo pipefail

pushd "$(dirname "$0")" > /dev/null
SCRIPT_DIR="$(pwd)"
popd > /dev/null

if [ -z ${MONGO_URI+x} ]; then
  export MONGO_URI="mongodb://localhost:27017/webknossos-testing"
fi

$SCRIPT_DIR/dropDB.sh $MONGO_URI
$SCRIPT_DIR/import_export/import.sh $MONGO_URI test/db
