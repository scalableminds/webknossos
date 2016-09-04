#!/bin/sh

getent group <%= group %> > /dev/null 2>&1
if [ $? -eq 2 ]; then
  groupadd -r <%= group %>
fi

getent passwd <%= user %> > /dev/null 2>&1
if [ $? -eq 2 ]; then
  mkdir -p /var/lib/<%=user %>
  useradd -d /var/lib/<%=user %> -g <%=group %> -s /bin/bash -r <%= user %>
fi

mkdir -p <%= logdir %>
chown -R <%= user %>:adm <%= logdir %>