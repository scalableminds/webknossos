_                  = require("lodash")
Marionette         = require("backbone.marionette")
Toast              = require("libs/toast")
SimpleTaskItemView = require("./simple_task_item_view")
TaskCollection     = require("admin/models/task/task_collection")

class TaskTypeItemView extends Marionette.CompositeView

  template : _.template("""
    <tr id="<%- id %>">
      <td><%- id %></td>
      <td><%- team %></td>
      <td><%- summary %></td>
      <td><%- formattedShortText %></td>
      <td>
        <% _.each(settings.allowedModes, function (mode) { %>
          <% var cssClass = mode == settings.preferredMode ? "label-primary" : "label-default"; %>
          <span class="label <%= cssClass %>">
            <%= mode[0].toUpperCase() + mode.slice(1) %>
          </span>
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
      <td><%- expectedTime %></td>
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
    </tr>
  """)

  childView : SimpleTaskItemView
  childViewContainer : "tbody"
  tagName : "tbody"

  events :
    "click .delete" : "deleteTaskType"

  initialize : ->

    @collection = new TaskCollection(null, taskTypeId : @model.get("id"))


  deleteTaskType : (evt) ->

    evt.preventDefault()

    if window.confirm("Do you really want to delete this task type?")
      @model.destroy().then((response) =>
        Toast.message(response.messages)
      )


module.exports = TaskTypeItemView
