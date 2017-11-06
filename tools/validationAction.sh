#!/bin/bash
if [ ! $2 ]; then
  echo " Example of use: $0 error/warn database_name schema_dir"
  exit 1
fi

db=$1
schema_dir=$3
action=$2

host="$4"
if [ ! $4 ]; then
  host="localhost:27017"
fi

for script in `ls $schema_dir`
do
  collection=${script%.schema.js}
  mongo "$host/$db" --eval "db.runCommand({ collMod: '$collection', validationAction: '$action'});"
done
