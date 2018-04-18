#!/bin/bash
# Adjusted from http://stackoverflow.com/a/13550669/783758

if [ ! $1 ]; then
  echo " Example of use: $0 database_name [dir_to_store]"
  exit 1
fi

uri=$1
out_dir=$2
if [ ! $out_dir ]; then
  out_dir="./"
else
  mkdir -p $out_dir
fi

cols=`mongo "$uri" --eval "print(db.getCollectionNames())" | tail -n1 | tr ',' ' '`

for c in $cols
do
  mongoexport --uri "$uri" --collection "$c" -o "$out_dir/${c}.json"
done
