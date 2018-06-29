#!/usr/bin/env bash
set -Eeuo pipefail

scriptdir="$(dirname "$0")"

ORIGINAL_POSTGRES_URL="${POSTGRES_URL:-jdbc:postgresql://localhost/webknossos}"

function dump {
  set -Eeuo pipefail
  if [[ "$1" == "DB" ]]; then
    export POSTGRES_URL="$ORIGINAL_POSTGRES_URL"
  else
    tempDbName="wk_tmp_$(cat /dev/urandom | tr -dc 'a-z0-9' | fold -w 8 | head -n 1)" || true
    export POSTGRES_URL="$(dirname "$ORIGINAL_POSTGRES_URL")/$tempDbName"
    dbName="$("$scriptdir"/db_name.sh)"
    [[ "$dbName" == "$tempDbName" ]]
    echo "Creating DB $dbName" 1>&2
    dbHost="$("$scriptdir"/db_host.sh)"

    PGPASSWORD=postgres psql -U postgres -h $dbHost -c "CREATE DATABASE $dbName;" 1>&2
    trap "rv=\$?; PGPASSWORD=postgres psql -U postgres -h $dbHost -c \"DROP DATABASE $dbName;\" 1>&2; exit \$rv" EXIT
    for f in $1; do
      if ! [ -e "$f" ]; then
        echo "Could not find $f." 1>&2
        exit 1
      fi
    done
    # expanding glob patterns:
    files="$(echo $1 | awk '{$1=$1; print}' OFS=" -f ")"
    PGPASSWORD=postgres psql -U postgres -h $dbHost --dbname="$dbName" -v ON_ERROR_STOP=ON -q -f $files 1>&2
  fi

  tmpdir="$(mktemp -d)"
  trap "rv=\$?; echo CLEANUP $tmpdir 1>&2; 1>&2; rm -rf $tmpdir; exit \$rv" ERR
  "$scriptdir/dump_schema.sh" "$tmpdir"
  echo "$tmpdir"
}

if [ "$#" -ne 2 ]
then
  echo "Usage: $0 <sqlFiles|DB> <sqlFiles|DB>"
  echo "Examples:"
  echo "  $0 tools/postgres/schema.sql \"conf/evolutions/*.sql\""
  echo "  $0 tools/postgres/schema.sql DB"
  exit 1
fi

dir1="$(dump "$1")"
trap "rv=\$?; echo CLEANUP $dir1 1>&2; rm -rf $dir1; exit \$rv" EXIT
dir2="$(dump "$2")"
trap "rv=\$?; echo CLEANUP $dir1 $dir2 1>&2; rm -rf $dir1 $dir2; exit \$rv" EXIT

# strip trailing commas and sort schema files:
find "$dir1" -type f -exec sed -i 's/,$//' {} +
find "$dir1" -type f -exec sort -o {} {} \;
find "$dir2" -type f -exec sed -i 's/,$//' {} +
find "$dir2" -type f -exec sort -o {} {} \;

diff -r "$dir1" "$dir2"
