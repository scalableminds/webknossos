_                  = require("lodash")
Marionette         = require("backbone.marionette")
WorkloadCollection = require("admin/models/workload/workload_collection")
TemplateHelpers      = require("libs/template_helpers")

class WorkloadListItemView extends Marionette.View

  tagName : "tr"
  template : _.template("""
    <td><%- name %></td>
    <td>
      <% _.each(teams.sort(), function(team){ %>
          <span class="label label-default" style="background-color: <%- TemplateHelpers.stringToColor(team) %>"><%- team %></span>
      <% }) %>
    </td>
    <td><%- projects.join(", ") %></td>
    <td><%- availableTaskCount %></td>
  """)

  templateContext:
    TemplateHelpers : TemplateHelpers

module.exports = WorkloadListItemView
