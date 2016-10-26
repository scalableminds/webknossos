_          = require("lodash")
Marionette = require("backbone.marionette")
Toast      = require("libs/toast")
Request    = require("libs/request")
moment     = require("moment")

class DashboardTaskListItemView extends Marionette.View

  tagName : "tr"

  template : _.template("""
    <td>
      <div class="monospace-id">
        <%- id %>
      </div>
    </td>
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
    <td><%- moment(created).format("YYYY-MM-DD HH:SS") %></td>
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
          </br>
          <a href="#" id="cancel-task">
            <i class="fa fa-trash-o"></i>
            cancel
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

  templateContext :
    moment : moment

  events :
    "click #finish-task" : "finish"
    "click #cancel-task" : "cancelAnnotation"


  className : ->

    if @model.get("annotation.state.isFinished")
      return "finished"
    else
      return "unfinished"


  initialize : (options) ->

    @model.set("isAdminView", options.isAdminView)
    @listenTo(@model, "change", @render)


  finish : ->

    if confirm("Are you sure you want to permanently finish this tracing?")
      @model.finish()


  cancelAnnotation : ->

    if confirm("Do you really want to cancel this annotation?")
      annotation = @model.get("annotation")
      Request.triggerRequest("/annotations/#{annotation.typ}/#{annotation.id}", method : "DELETE").then( =>
        @model.collection.fetch()
      )


module.exports = DashboardTaskListItemView
