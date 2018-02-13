#!/usr/bin/env bash
set -Eeuo pipefail

dbName=${DB_NAME:-webknossos}

schemaPath="$(dirname "$0")/schema.sql"

PGPASSWORD=postgres psql -U postgres -h  ${POSTGRES_HOST:-localhost} --dbname=$dbName -f $schemaPath
