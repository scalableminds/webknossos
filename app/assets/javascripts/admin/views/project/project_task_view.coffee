_          = require("lodash")
Marionette = require("backbone.marionette")

class ProjectTaskView extends Backbone.Marionette.ItemView

  tagName : "tr"
  template : _.template("""
    <td>
      <a href="/tasks#<%= id %>">
        <%= id.slice(-6) %>
      </a>
    </td>
    <td>
      <% if(type){ %>
        <a href="/taskTypes#<% type.id %>">
          <%= type.summary %>
        </a>
      <% } %>
    </td>
    <td>
      <%= dataSet %>
    </td>
    <td>
      <span title="Unassigned">
        <i class="fa fa-play-circle"></i><%= status.open %> open
      </span>
      |
      <span title="in Progress">
        <i class="fa fa-random"></i><%= status.inProgress %> active
      </span>
      |
      <span title="Completed">
        <i class="fa fa-check-circle-o"></i><%= status.completed %> done
      </span>

    </td>
    <td>
      Traced Time: <%= tracingTime %>
    </td>
    <td class="nowrap">
      <a href="/api/tasks/<%= id %>/download" title="Download all finished tracings">
        <i class="fa fa-download"></i>download
      </a>
    </td>
  """)

module.exports = ProjectTaskView
