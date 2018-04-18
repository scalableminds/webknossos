#!/bin/bash
if [ ! $2 ]; then
  echo " Example of use: $0 database_name schema_dir"
  exit 1
fi

uri=$1
schema_dir=$2

for schema in `ls $schema_dir`
do
  mongo "$uri" "$schema_dir/$schema"
done
