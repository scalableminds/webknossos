### define
underscore : _
backbone.marionette : Marionette
admin/models/workload/workload_collection : WorkloadCollection
libs/template_helpers : TemplateHelpers
###

class WorkloadListItemView extends Backbone.Marionette.CompositeView
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

  templateHelpers:
    TemplateHelpers : TemplateHelpers

