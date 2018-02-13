#!/bin/bash
set -Eeuo pipefail

pushd "$(dirname "$0")" > /dev/null
SCRIPT_DIR="$(pwd)"
popd > /dev/null

DB_NAME="webknossos_testing" $SCRIPT_DIR/ensure_db.sh
DB_NAME="webknossos_testing" $SCRIPT_DIR/refresh_schema.sh

for file in $(find $SCRIPT_DIR/../../test/db_postgres -name "*.csv")
do
  echo $file
  PGPASSWORD=postgres psql -U postgres -h ${POSTGRES_HOST:-localhost} --dbname="webknossos_testing" -c "COPY webknossos.$(basename $file .csv) FROM STDOUT WITH CSV HEADER QUOTE ''''" < $file
done;
