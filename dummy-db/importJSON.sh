#!/bin/sh

DB=${1:-play-oxalis}
PORT=${2:-27017}

echo $DB
echo $PORT

LOCATION=$(dirname $0)

for f in $LOCATION/*.json
do
  # extract collection name from filename
  collection=$(basename ${f%.*})
  echo "Importing $collection"

  mongoimport --db $DB --port $PORT --collection $collection --file $f

done
