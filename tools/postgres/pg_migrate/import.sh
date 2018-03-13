#!/bin/bash
set -Eeuo pipefail

if [ -f out/bearerTokenAuthenticators.csv ]; then
	mv out/bearerTokenAuthenticators.csv out/tokens.csv
fi

for file in $(find out -name "*.csv")
do
  echo $file
  PGPASSWORD=postgres psql -U postgres -h ${POSTGRES_HOST:-localhost} --dbname="webknossos" -c "COPY webknossos.$(basename $file .csv) FROM STDOUT WITH CSV HEADER QUOTE ''''" < $file
done;
