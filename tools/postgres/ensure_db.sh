#!/usr/bin/env bash
set -Eeuo pipefail

dbName='webknossos'

if [ "$( psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'" )" = '1' ]
then
    echo "Database already exists"
    exit
fi

psql -U postgres -h localhost -c "CREATE DATABASE $dbName;"
$(dirname "$0")/ensure_schema.sh
