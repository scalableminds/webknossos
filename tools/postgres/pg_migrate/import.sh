#!/bin/bash
set -Eeuo pipefail

for f in $(find out -name "*.csv")
do
  echo $f
  psql -c "COPY webknossos.$(basename $f .csv) FROM STDOUT WITH CSV HEADER QUOTE ''''" < $f
done;
