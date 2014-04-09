#!/bin/sh

<% name = project + "-" + branch %>
<% user = name %>
<% group = project %>
<% log_dir = "/var/log/" + name %>
<% run_dir = "/var/run/" + name %>

getent group <%= project %> > /dev/null 2>&1
if [ $? -eq 2 ]; then
  groupadd -r <%= project %>
fi

getent passwd <%= name %> > /dev/null 2>&1
if [ $? -eq 2 ]; then
  useradd -md /var/lib/<%=name %> -g <%=project %> -s /bin/bash -r <%= name %>
fi

mkdir -p <%= log_dir %>
chown -R <%= user %>:adm <%= log_dir %>
mkdir -p <%= run_dir %>
chown -R <%= user %>:root <%= run_dir %>