#!/bin/sh

if [ "$1" = "purge" -o "$1" = "0" ];then
  service <%= application %> stop
  update-rc.d -f <%= application %> remove
fi