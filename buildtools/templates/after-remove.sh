#!/bin/sh


if [ "$1" = "purge" -o "$1" = "0" ];then

  echo "removing user <%= name %>..."
  getent passwd <%= name %>
  if [ $? -eq 0 ]; then
    userdel -r <%= name %>
  fi

  echo "removing group <%= group %>..."
  getent group <%= group %>
  if [ $? -eq 0 ]; then
    groupdel <%= group %>
    if [ $? -eq 8 ]; then
      echo "Group is not removed as there are still other users in this group"
    fi
  fi

  rm -rf <%= logdir %>
fi