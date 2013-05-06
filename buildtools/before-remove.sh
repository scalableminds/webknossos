#!/bin/sh

<% if init_system == "systemd" %>
systemctl stop <%= name %>.service
systemctl disable <%= name %>.service
<% end %>

<% if init_system == "sysvinit" %>
service <%= name %> stop
update-rc.d -f <%= name %> remove
<% end %>