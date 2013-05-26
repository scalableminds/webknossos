#!/bin/sh

<% if init_system == "systemd" %>
systemctl daemon-reload
systemctl enable <%= name %>.service
systemctl start <%= name %>.service
<% end %>

<%if init_system == "sysvinit" %>
update-rc.d <%= name %> defaults
service <%= name %> start
<% end %>
