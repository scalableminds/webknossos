#!/bin/bash

db="$1"
if [ ! $1 ]; then
  db="play-oxalis"
fi

host="$2"
if [ ! $2 ]; then
  host="localhost"
fi

port="$3"
if [ ! $3 ]; then
  port="27017"
fi

echo "Dropping database: $db at ${host}:$port"
mongo "$db" --host "$host" --port "$port" --eval "db.dropDatabase()"
