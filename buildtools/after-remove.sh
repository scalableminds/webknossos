#!/bin/sh


if [ "$1" = "purge" -o "$1" = "0" ];then
  if [ -d /etc/<%= name %> ]; then
    rm -r /etc/<%= name %>
  fi

  getent passwd <%= name %>
  result=$? 
  if [ $result -eq 0 ]; then
    userdel <%= name %>
  fi

  getent group <%= name %>
  result=$? 
  if [ $result -eq 0 ]; then
    groupdel <%= name %>
  fi
fi