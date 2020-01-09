#!/usr/bin/env bash
set -Eeuo pipefail

scriptdir="$(dirname "$0")"

dbName="$("$scriptdir"/db_name.sh)"
dbHost="$("$scriptdir"/db_host.sh)"

dbExistence="$(PGPASSWORD=postgres psql -U postgres -h $dbHost -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'" )"
if [ "$dbExistence" = '1' ]
then
    echo "Database already exists"
else
	PGPASSWORD=postgres psql -U postgres -h $dbHost -c "CREATE DATABASE $dbName;"
fi

"$(dirname "$0")"/ensure_schema.sh
