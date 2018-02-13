#!/usr/bin/env bash
set -Eeuo pipefail

dbName=${DB_NAME:-webknossos}

PGPASSWORD=postgres psql -U postgres -h ${POSTGRES_HOST:-localhost} -c "DROP DATABASE $dbName;"
