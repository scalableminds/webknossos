#!/bin/sh

if [ "$1" = "purge" -o "$1" = "0" ];then
  service rsyslog restart
  service nginx reload
fi