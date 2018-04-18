#!/bin/bash

uri="$1"
if [ ! $1 ]; then
  uri="mongodb://localhost:27017/play-oxalis"
fi

echo "Dropping database: $uri"
mongo "$uri" --eval "db.dropDatabase()"
