#!/bin/sh

getent group <%= group %>
if [ $? -eq 2 ]; then
  groupadd -r <%= group %>
fi

getent passwd <%= user %>
if [ $? -eq 2 ]; then
  useradd -md /usr/lib/<%= application %> -g <%= group %> -s /bin/bash -r <%= user %>
fi