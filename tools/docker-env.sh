#!/usr/bin/env bash

# Start Docker
export POSTGRES_URL=jdbc:postgresql://localhost:5434/webknossos
export POSTGRES_USER="webknossos"
export POSTGRES_PASSWORD="secret"

cd .github || exit
docker compose down -v
docker compose up -d postgres redis fossildb
cd .. || exit

"$@"
RESULT=$?

cd .github || exit
docker compose down -v
cd .. || exit

exit "$RESULT"
