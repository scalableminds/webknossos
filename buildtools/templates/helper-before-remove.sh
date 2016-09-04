#!/bin/sh

<% if pkgType == "rpm" %>
systemctl stop <%= application %>.service
systemctl disable <%= application %>.service
<% end %>

<% if pkgType == "deb" %>
service <%= application %> stop
update-rc.d -f <%= application %> remove
<% end %>
