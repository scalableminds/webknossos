#!/usr/bin/env bash
set -Eeuo pipefail

dbName='webknossos'

psql -U postgres -h ${POSTGRES_HOST:-localhost} -c "DROP DATABASE $dbName;"
