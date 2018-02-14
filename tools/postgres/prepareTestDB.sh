#!/bin/bash
set -Eeuo pipefail

scriptdir=$(dirname "$0")

dbName="webknossos_testing"
dbHost=$($scriptdir/db_host.sh)

POSTGRES_URL="jdbc:postgresql://$dbHost/$dbName" $scriptdir/ensure_db.sh
POSTGRES_URL="jdbc:postgresql://$dbHost/$dbName" $scriptdir/refresh_schema.sh

for file in $(find $scriptdir/../../test/db_postgres -name "*.csv")
do
  echo $file
  PGPASSWORD=postgres psql -U postgres -h $dbHost --dbname=$dbName -c "COPY webknossos.$(basename $file .csv) FROM STDOUT WITH CSV HEADER QUOTE ''''" < $file
done;
