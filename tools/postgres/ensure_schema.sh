#!/usr/bin/env bash
set -Eeuo pipefail

scriptdir=$(dirname "$0")

dbName=$($scriptdir/db_name.sh)
dbHost=$($scriptdir/db_host.sh)

schemaPath="$scriptdir/schema.sql"

if [ "$(PGPASSWORD=postgres psql -U postgres -h  $dbHost --dbname=$dbName -tAc "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'webknossos';")" = 'webknossos' ]
then
    echo "Schema already exists"
    exit
fi

PGPASSWORD=postgres psql -U postgres -h  $dbHost --dbname=$dbName -f $schemaPath
