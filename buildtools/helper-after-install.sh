#!/bin/sh

service rsyslog restart
service nginx reload

update-rc.d <%= application %> defaults
service <%= application %> start