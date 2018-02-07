#!/usr/bin/env bash
set -Eeuo pipefail

dbName='webknossos'

psql -U postgres -h localhost -c "DROP DATABASE $dbName;"
