#!/bin/bash

datastorehost=$1
authtoken=$2
tracingid=$3

for i in `seq 1 100`;
do
  ./send-update.sh $datastorehost $authtoken $tracingid $i
done
