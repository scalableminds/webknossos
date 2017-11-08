#!/bin/bash
if [ ! $2 ]; then
  echo " Example of use: $0 database_name schema_dir"
  exit 1
fi

db=$1
schema_dir=$2

host="$3"
if [ ! $3 ]; then
  host="localhost:27017"
fi

for schema in `ls $schema_dir`
do
  mongo "$host/$db" "$schema_dir/$schema"
done
