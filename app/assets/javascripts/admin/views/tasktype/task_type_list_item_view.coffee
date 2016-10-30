_                  = require("lodash")
Marionette         = require("backbone.marionette")
Toast              = require("libs/toast")

class TaskTypeItemView extends Marionette.View

  template : _.template("""
    <td class="monospace-id"><%- id %></td>
    <td><%- team %></td>
    <td><%- summary %></td>
    <td><%- formattedShortText %></td>
    <td>
      <% _.each(settings.allowedModes, function (mode) { %>
      <% var modename = mode[0].toUpperCase() + mode.slice(1); %>
      <% if(mode == settings.preferredMode) { %>
        <span class="label label-primary" title="default mode"><%= modename %></span><br />
      <% } else { %>
        <span class="label label-default" ><%= modename %></span><br />
      <% } %>
      <% }) %>
    </td>
    <td>
      <% if(settings.branchPointsAllowed) { %>
      <span class="label label-default">Branchpoints</span>
      <% } %>
      <% if(settings.somaClickingAllowed) { %>
      <span class="label label-default">Soma clicking</span>
      <% } %>
      <% if(settings.advancedOptionsAllowed) { %>
      <span class="label label-default">Advanced Options</span>
      <% } %>
    </td>
    <td>
      <%- expectedTime.min %> - <%- expectedTime.max %>,<br>
      Limit: <%- expectedTime.maxHard %>
    </td>
    <td><%- fileName %></td>
    <td class="nowrap">
      <a href="/taskTypes/<%- id %>/edit" >
      <i class="fa fa-pencil"></i>edit
      </a> <br />
      <a href="/annotations/CompoundTaskType/<%- id %>" title="view all finished tracings">
      <i class="fa fa-random"></i>view
      </a> <br />
      <a href="/taskTypes/<%- id %>/tasks" title="View Tasks">
      <i class="fa fa-tasks"></i>tasks
      </a> <br />
      <a href="/api/taskTypes/<%- id %>/download" >
      <i class="fa fa-download"></i>download
      </a> <br />
      <a href="#" class="delete">
      <i class="fa fa-trash-o"></i>delete
      </a>
    </td>
  """)

  tagName : "tr"

  events :
    "click .delete" : "deleteTaskType"

  deleteTaskType : (evt) ->

    evt.preventDefault()

    if window.confirm("Do you really want to delete this task type?")
      @model.destroy().then((response) =>
        Toast.message(response.messages)
      )


module.exports = TaskTypeItemView
