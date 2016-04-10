#!/bin/bash
# Adjusted from http://stackoverflow.com/a/13550669/783758

if [ ! $1 ]; then
  echo " Example of use: $0 database_name [dir_to_store]"
  exit 1
fi

db=$1
out_dir=$2
if [ ! $out_dir ]; then
  out_dir="./"
else
  mkdir -p $out_dir
fi

js="print('_ ' + db.getCollectionNames())"
cols=`mongo $db --eval "$js" | grep '_' | awk '{print $2}' | tr ',' ' '`

for c in $cols
do
  mongoexport --db $db --collection $c -o "$out_dir/${c}.json"
done
