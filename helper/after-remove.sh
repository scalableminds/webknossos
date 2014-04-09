#!/bin/sh

<% name = project + "-" + branch %>
<% user = name %>
<% group = project %>
<% log_dir = "/var/log/" + name %>
<% run_dir = "/var/run/" + name %>

#Only clean up if the package is really removed and not just updated
if [ "$1" = "purge" -o "$1" = "0" ];then

  getent passwd <%= user %>
  if [ $? -eq 0 ]; then
    userdel -r <%= user %>
  fi

  echo "removing group <%= group %>..."
  getent group <%= group %>
  if [ $? -eq 0 ]; then
    groupdel <%= group %>
    if [ $? -eq 8 ]; then
      echo "Group is not removed as there are still other users in this group"
    fi
  fi

  rm -rf <%= log_dir %>
  rm -rf <%= run_dir %>
fi