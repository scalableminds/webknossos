#!/bin/sh

getent group <%= name %>
result=$? 
if [ $result -eq 2 ]; then
  groupadd -r <%= name %>
fi

getent passwd <%= name %>
result=$? 
if [ $result -eq 2 ]; then
  useradd -md /usr/lib/<%=name %> -g <%=name %> -s /bin/bash -r <%= name %>
fi

mkdir -p /etc/<%= name %>
chown -R <%= name %>:<%= name %> /etc/<%= name %>
chmod -R 755 /etc/<%= name %>