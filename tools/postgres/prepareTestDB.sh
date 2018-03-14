#!/bin/bash
set -Eeuo pipefail

scriptdir="$(dirname "$0")"

$scriptdir/ensure_db.sh
$scriptdir/refresh_schema.sh

dbName=$($scriptdir/db_name.sh)
dbHost=$($scriptdir/db_host.sh)

for file in $(find $scriptdir/../../test/db_postgres -name "*.csv")
do
  echo $file
  PGPASSWORD=postgres psql -U postgres -h $dbHost --dbname=$dbName -c "COPY webknossos.$(basename $file .csv) FROM STDOUT WITH CSV HEADER QUOTE ''''" < $file
done;

echo "Done preparing test db (host=$dbHost, name=$dbName)"
