#!/usr/bin/env bash

set -e

grep -oR -P '(conf|configuration)\.get[a-z,A-Z]+\(.+?\)(\.getOrElse\(.+?\))?' app | sort | while read line; do
  file=$(echo $line | cut -d : -f 1)
  match=$(echo $line | cut -d : -f 2-)
  key=$(echo $line | cut -d \( -f 2 | cut -d\) -f 1 | tr -d '"')
  default=$(echo $line | cut -d \( -f 3 | cut -d\) -f 1 | tr -d '"')
  printf "%-50s" "$key"
  echo " $file ($default)"
done
