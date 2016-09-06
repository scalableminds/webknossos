#!/bin/sh


<% if pkgType == "rpm" %>
systemctl daemon-reload
<% end %>

<%if pkgType == "deb" %>
service rsyslog restart
service nginx reload
<% end %>
