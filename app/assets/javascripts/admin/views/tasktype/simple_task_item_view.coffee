_          = require("lodash")
Marionette = require("backbone.marionette")

class SimpleTaskItemView extends Marionette.CompositeView

  tagName : "tr"
  template : _.template("""
    <td>
      <a href="/tasks#<%- id %>">
        <%- formattedHash %>
      </a>
    </td>
    <td>
      <a href="/taskTypes#<%- id %>">
        <%- type.summary %>
      </a>
    </td>
    <td>
      <%- dataSet %>
    </td>
    <td>
      <span title="Unassigned">
        <i class="fa fa-play-circle"></i>
        <%- status.open %> open
      </span>
      |
      <span title="in Progress">
        <i class="fa fa-random"></i>
        <%- status.inProgress %> active
      </span>
      |
      <span title="Completed">
        <i class="fa fa-check-circle-o"></i>
        <%- status.completed %> done
      </span>
    </td>
    <td>
      Tracked Time: <%- formattedTracingTime %>
    </td>
    <td class="nowrap">
      <% if (status.completed > 0) { %>
        <a href="/api/tasks/<%- id %>/download" title="download all finished tracings">
          <i class="fa fa-download"></i>
          download
        </a>
      <% } %>
    </td>
  """)

module.exports = SimpleTaskItemView
