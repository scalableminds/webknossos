#!/usr/bin/env bash
set -Eeuo pipefail

scriptdir="$(dirname "$0")"

dbName="$("$scriptdir"/db_name.sh)"
dbHost="$("$scriptdir"/db_host.sh)"

PGPASSWORD=postgres psql -U postgres -h $dbHost --dbname=$dbName -f "$scriptdir"/schema.sql
