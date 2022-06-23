#!/usr/bin/env bash
set -Eeuo pipefail

scriptdir="$(dirname "$0")"

dbName="$("$scriptdir"/db_name.sh)"
dbHost="$("$scriptdir"/db_host.sh)"

if [[ $1 == "true" ]]; then
  echo "Enabling jobs in the local database by inserting a worker."
  PGPASSWORD=postgres psql -U postgres -h "$dbHost" --dbname="$dbName" -c "insert into webknossos.workers(_id, _dataStore, key) values('6194dc03040200b0027f28a1', 'localhost', 'secretWorkerKey') on conflict do nothing"
elif [[ $1 == "false" ]]; then
  echo "Disabling jobs in the local database by removing the worker. If existing jobs prevent the delete, use yarn refresh-schema to reset the db or remove the existing jobs manually."
  PGPASSWORD=postgres psql -U postgres -h "$dbHost" --dbname="$dbName" -c "delete from webknossos.workers where _id = '6194dc03040200b0027f28a1'"
else
  echo "set_jobs was called without valid parameter. Either supply 'true' or 'false' ";
fi
