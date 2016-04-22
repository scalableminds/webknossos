#!/bin/bash
# Adjusted from http://stackoverflow.com/a/13550669/783758

if [ ! $1 ]; then
  echo " Example of use: $0 database_name [dir_to_store]"
  exit 1
fi

host="$3"
if [ ! $3 ]; then
  host="localhost"
fi

port="$4"
if [ ! $4 ]; then
  port="27017"
fi

db=$1
out_dir=$2
if [ ! $out_dir ]; then
  out_dir="./"
else
  mkdir -p $out_dir
fi

cols=`mongo "$db" --host "$host" --port "$port" --eval "print(db.getCollectionNames())" | tail -n1 | tr ',' ' '`

for c in $cols
do
  mongoexport --db "$db" --host "$host" --port "$port" --collection "$c" -o "$out_dir/${c}.json"
done
