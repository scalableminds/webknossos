#!/usr/bin/env bash
# Spins up a disposable Postgres container loaded with the real webKnossos schema
# (schema/schema.sql) plus one seed user, for locally running/testing wk-auth-poc.
# Safe to re-run: recreates the container from scratch each time.
set -euo pipefail

CONTAINER_NAME="wk-poc-postgres"
PORT="${WK_POC_PG_PORT:-15432}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
  echo "Removing existing ${CONTAINER_NAME} container..."
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

echo "Starting Postgres on localhost:${PORT}..."
docker run -d --name "${CONTAINER_NAME}" \
  -e POSTGRES_DB=webknossos -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -p "${PORT}:5432" postgres:15-bullseye >/dev/null

echo "Waiting for Postgres to be ready..."
for _ in $(seq 1 30); do
  docker exec "${CONTAINER_NAME}" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

echo "Loading webKnossos schema..."
docker cp "${REPO_ROOT}/schema/schema.sql" "${CONTAINER_NAME}:/tmp/schema.sql"
docker exec -e PGPASSWORD=postgres "${CONTAINER_NAME}" \
  psql -q -U postgres -d webknossos -f /tmp/schema.sql >/dev/null

echo "Seeding test user..."
docker cp "${REPO_ROOT}/rust-poc/scripts/seed.sql" "${CONTAINER_NAME}:/tmp/seed.sql"
docker exec -e PGPASSWORD=postgres "${CONTAINER_NAME}" \
  psql -q -U postgres -d webknossos -f /tmp/seed.sql

cat <<EOF

Postgres is running on localhost:${PORT} (user/password: postgres/postgres).
Test login: poc-user@example.com / poc-password123

Run the service with:
  cd rust-poc
  POSTGRES_URL="postgres://postgres:postgres@localhost:${PORT}/webknossos" cargo run

Tear down with:
  docker rm -f ${CONTAINER_NAME}
EOF
