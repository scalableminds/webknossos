#!/usr/bin/env bash
set -Eeuo pipefail

scriptdir="$(dirname "$0")"

dbName="$("$scriptdir"/db_name.sh)"
dbHost="$("$scriptdir"/db_host.sh)"

FORMATING=$(cat <<-"EOM"
{
  folder=(schemadir "/" $1);
  file=$2;
  gsub(/ /, "", folder);
  gsub(/ /, "", file);
  system("mkdir -p " folder);
  print > (folder "/" file)
}
EOM
)

if [ "$#" -ne 1 ]
then
  echo "Usage: $0 <schemadir>"
  exit 1
fi

schemadir="$1"

if ! [ -d "$schemadir" ]; then
  echo "Schema directory $schemadir does not exist, aborting!"
  exit 1
fi
rm -rf "$schemadir"/*

echo "dumping $dbName to $schemadir" 1>&2

PGPASSWORD=postgres psql -U postgres -h "$dbHost" --dbname "$dbName" -c "\d+ webknossos.*" | \
  awk -v RS= -v FS='"' -v schemadir="$schemadir" "$FORMATING"

PGPASSWORD=postgres psql -U postgres -h "$dbHost" --dbname "$dbName" -c "\df+ webknossos.*" > "$schemadir/Functions"
