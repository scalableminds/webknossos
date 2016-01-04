_          = require("lodash")
marionette = require("backbone.marionette")
Toast      = require("libs/toast")

class DashboardTaskListItemView extends Backbone.Marionette.ItemView

  tagName : "tr"

  template : _.template("""
    <td><%- formattedHash     %></td>
    <td><%- type.summary      %></td>
    <td><%- projectName       %></td>
    <td><%- type.description  %></td>
    <td>
      <% _.each(type.settings.allowedModes, function(mode) { %>
        <span class="label-default label">
          <%- mode %>
        </span>
      <% }) %>
    </td>
    <td class="nowrap">
      <% if (annotation.state.isFinished) { %>
        <i class="fa fa-check"></i><span> Finished</span><br />
      <% } else { %>
        <a href="/annotations/<%- annotation.typ %>/<%- annotation.id %>">
          <i class="fa fa-random"></i>
          <strong>trace</strong>
        </a>
        <% if (isAdminView) { %>
          <br/>
          <a href="/annotations/<%- annotation.typ %>/<%- annotation.id %>/transfer" id="transfer-task">
            <i class="fa fa-share"></i>
            transfer
          </a>
        <% } %>
        <br/>
        <a href="#" id="finish-task" class="trace-finish">
          <i class="fa fa-check-circle-o"></i>
          finish
        </a>
      <% } %>
    </td>
  """)

  events :
    "click #finish-task" : "finish"


  className : ->

    if @model.get("annotation").state.isFinished
      return "finished"
    else
      return "unfinished"


  initialize : (options) ->

    @model.set("isAdminView", options.isAdminView)
    @listenTo(@model, "change", @render)


  finish : ->

    if confirm("Are you sure you want to permanently finish this tracing?")

      @model.finish()


module.exports = DashboardTaskListItemView
