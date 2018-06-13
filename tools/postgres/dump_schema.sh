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

SCHEMADIR="$scriptdir/../../schema"

if ! [ -d "$SCHEMADIR" ]; then
	echo "Schema directory $SCHEMADIR does not exist, aborting!"
	exit 1
fi
rm -rf "$SCHEMADIR"/*

PGPASSWORD=postgres psql -U postgres -h "$dbHost" --dbname "$dbName" -c "\d+ webknossos.*" | \
  awk -v RS= -v FS='"' -v schemadir="$SCHEMADIR" "$FORMATING"
