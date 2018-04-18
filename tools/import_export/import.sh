#!/bin/bash
# Adjusted from http://stackoverflow.com/a/13550669/783758

if [ ! $2 ]; then
  echo " Example of use: $0 database_name dump_dir"
  echo " dump_dir should contain <collection>.json files for each collection."
  exit 1
fi

uri=$1
dump_dir=$2

for dump_file in `ls $dump_dir`
do
  collection=${dump_file%.json}
  mongo "$uri" --eval "db.${collection}.drop()"
  mongo "$uri" --eval "db.createCollection('$collection')"
done

bash ../activateValidation.sh "$uri" "$dump_dir/../../conf/schemas"
bash ../validationAction.sh "$uri" "error" "$dump_dir/../../conf/schemas"

for dump_file in `ls $dump_dir`
do
  collection=${dump_file%.json}
  mongoimport --uri "$uri" --collection "$collection" --file "$dump_dir/$dump_file"
done
