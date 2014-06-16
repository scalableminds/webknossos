#!/bin/sh

DB=${1:-play-oxalis}
PORT=${2:-27017}

echo $DB
echo $PORT

for f in *.json
do
  # extract collection name from filename
  collection=${f%.*}
  echo "Importing $collection"

  mongoimport --db $DB --port $PORT --collection $collection --file $f

done