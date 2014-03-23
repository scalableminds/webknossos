### define
underscore : _
backbone.marionette : marionette
libs/toast : Toast
###

class DashboardTaskListItemView extends Backbone.Marionette.ItemView

  tagName : "tr"

  template : _.template("""
    <td><%= formattedHash     %></td>
    <td><%= type.summary      %></td>
    <td><%= projectName       %></td>
    <td><%= type.description  %></td>
    <td>
      <% _.each(type.settings.allowedModes, function(mode) { %>
        <span class="label-default label">
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
        <a href="#" id="finish-link" class="trace-finish">
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

  events :
    "click #finish-link" : "finish"


  initialize : ->

    @model.on('change', @render)


  finish : ->

    if confirm("Are you sure you want to permanently finish this tracing?")

      @model.finish().fail( (response) ->
        Toast.message(response.messages)
      )
