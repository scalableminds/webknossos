#!/bin/bash

db=$1
if [ ! $1 ]; then
  db="play-oxalis"
fi

echo "Dropping database: $db"
mongo $db --eval "db.dropDatabase()"
