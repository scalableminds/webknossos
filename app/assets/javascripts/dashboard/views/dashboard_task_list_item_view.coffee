### define
underscore : _
app : app
backbone.marionette : marionette
###

class DashboardTaskListItemView extends Backbone.Marionette.ItemView

  tagName : "tr"

  template : _.template("""
    <td><%= tasks.formattedHash     %></td>
    <td><%= tasks.type.summary      %></td>
    <td><%= tasks.projectName       %></td>
    <td><%= tasks.type.description  %></td>
    <td>
      <% _.each(tasks.type.settings.allowedModes, function(mode) { %>
        <span class="label">
          <%= mode %>
        </span>
      <% }) %>
    </td>
    <td class="nowrap">
      <% if (annotation.state.isFinished) { %>
        <i class="fa fa-check"></i><span> Finished</span><br />
      <% } else { %>
        <a href="/annotations/<%= annotation.typ %>/<%= annotation.id %>">
          <i class="fa fa-random"></i>
          trace
        </a>
        <br/>
        <a href="/annotations/<%= annotation.typ %>/<%= annotation.id %>/finish"
          class="trace-finish"
          data-ajax="replace-row,confirm=@Messages("annotation.finish.confirm")">
            <i class="fa fa-check-circle-o"></i>
            finish
        </a>
      <% } %>
    </td>
  """)

  className : ->

    if @model.get("annotation").state.isFinished
      return "finished"
    else
      return "unfinished"
