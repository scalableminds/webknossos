#!/bin/bash
# Adjusted from http://stackoverflow.com/a/13550669/783758

# was just used once to convert the testdata from mongo to sql.
# TODO: Remove before merge

uri="mongodb://localhost:27017/webknossos-testing"
dump_dir=~/scm/code/webknossos/test/db


for dump_file in `ls $dump_dir`
do
  collection=${dump_file%.json}
  echo $collection
  mongoimport --host localhost --port 27017 --db webknossos-testing --collection "$collection" --file "$dump_dir/$dump_file"
done
