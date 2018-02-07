#!/usr/bin/env bash
set -Eeuo pipefail

dbName='webknossos'

schemaPath="$(dirname "$0")/schema.sql"

if [ "$(PGPASSWORD=postgres psql -U postgres -h  ${POSTGRES_HOST:-localhost} --dbname=$dbName -tAc "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'webknossos';")" = 'webknossos' ]
then
    echo "schema already exists"
    exit
fi

PGPASSWORD=postgres psql -U postgres -h  ${POSTGRES_HOST:-localhost} --dbname=$dbName -f $schemaPath
