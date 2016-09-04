#!/bin/sh

if [ "$1" = "purge" -o "$1" = "0" ];then
  <%if pkgType == "deb" %>
  service rsyslog restart
  service nginx reload
  <% end %>
  echo "deinstalled <%=application%>"
fi
