### define
underscore : _
backbone.marionette : Marionette
###

class ProjectAnnotationView extends Backbone.Marionette.ItemView

  template : _.template("""
    <td>
      <a href="/tasks#<%= id %>">
        <%= shortId %>
      </a>
    </td>
    <td>
      <a href="/admin/taskTypes#<% taskTyp.id %>">
        <%= taskType.name %>
      </a>
    </td>
    <td>
      <%= dataset %>
    </td>
    <td>
      <span title="Unassigned">
        <i class="fa fa-play-circle"></i><%= state.open %> open
      </span>
      |
      <span title="in Progress">
        <i class="fa fa-random"></i><%= state.active %> active
      </span>
      |
      <span title="Completed">
        <i class="fa fa-check-circle-o"></i><%= state.done %> done
      </span>

    </td>
    <td>
        Tracked Time: -
    </td>
    <td class="nowrap">
      <a href="/admin/tasks/<%= id %>/download" title="Download all finished tracings">
        <i class="fa fa-download"></i>download
      </a>
    </td>
  """)

  tagName : "tr"