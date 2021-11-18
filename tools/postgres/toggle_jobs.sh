#!/usr/bin/env bash
set -Eeuo pipefail

scriptdir="$(dirname "$0")"

dbName="$("$scriptdir"/db_name.sh)"
dbHost="$("$scriptdir"/db_host.sh)"

PGPASSWORD=postgres psql -U postgres -h "$dbHost" --dbname="$dbName" -c "update webknossos.datastores set jobsEnabled = $1 where name = 'localhost'";

if [[ $1 == "true" ]]; then
  PGPASSWORD=postgres psql -U postgres -h "$dbHost" --dbname="$dbName" -c "insert into webknossos.workers(_id, _dataStore, key) values('6194dc03040200b0027f28a1', 'localhost', 'secretWorkerKey') on conflict do nothing"
else
  PGPASSWORD=postgres psql -U postgres -h "$dbHost" --dbname="$dbName" -c "delete from webknossos.workers where _id = '6194dc03040200b0027f28a1'"
fi
