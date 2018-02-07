#!/usr/bin/env bash
set -Eeuo pipefail

dbName='webknossos'

if [ "$( psql -U postgres -h ${POSTGRES_HOST:-localhost} -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'" )" = '1' ]
then
    echo "Database already exists"
else
	psql -U postgres -h  ${POSTGRES_HOST:-localhost} -c "CREATE DATABASE $dbName;"
fi

$(dirname "$0")/ensure_schema.sh
