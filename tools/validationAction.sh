#!/bin/bash
if [ ! $2 ]; then
  echo " Example of use: $0 error/warn database_name schema_dir"
  exit 1
fi

uri=$1
schema_dir=$3
action=$2

for script in `ls $schema_dir`
do
  collection=${script%.schema.js}
  mongo "$uri" --eval "db.runCommand({ collMod: '$collection', validationAction: '$action'});"
done
