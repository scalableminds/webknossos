#!/bin/sh

if [ $1 = "purge" -o $1 -eq 0 ];then
  <% if init_system == "systemd" %>
  systemctl stop <%= name %>.service
  systemctl disable <%= name %>.service
  <% end %>

  <% if init_system == "sysvinit" %>
  service <%= name %> stop
  update-rc.d -f <%= name %> remove
  <% end %>
fi