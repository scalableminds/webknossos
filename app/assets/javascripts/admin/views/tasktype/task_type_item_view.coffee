_                  = require("lodash")
Marionette         = require("backbone.marionette")
Toast              = require("libs/toast")
SimpleTaskItemView = require("./simple_task_item_view")
TaskCollection     = require("admin/models/task/task_collection")

class TaskTypeItemView extends Marionette.CompositeView

  template : _.template("""
    <tr id="<%- id %>">
      <td class="details-toggle" href="#">
        <i class="caret-right"></i>
        <i class="caret-down"></i>
      </td>
      <td><%- formattedHash %></td>
      <td><%- team %></td>
      <td><%- summary %></td>
      <td><%- formattedShortText %></td>
      <td>
        <% _.each(settings.allowedModes, function (mode) { %>
          <span class="label label-default"><%- mode[0].toUpperCase() + mode.slice(1) %></span>
        <% }) %>
      </td>
      <td>
        <% if(settings.branchPointsAllowed) { %>
          <span class="label label-default">Branchpoints</span>
        <% } %>
        <% if(settings.somaClickingAllowed) { %>
          <span class="label label-default">Soma clicking</span>
        <% } %>
      </td>
      <td><%- expectedTime %></td>
      <td><%- fileName %></td>
      <td class="nowrap">
        <a href="/taskTypes/<%- id %>/edit" >
          <i class="fa fa-pencil"></i>edit
        </a> <br />
        <% if (status.completed > 0) { %>
          <a href="/annotations/CompoundTaskType/<%- id %>" title="view all finished tracings">
            <i class="fa fa-random"></i>view
          </a> <br />
          <a href="/api/taskTypes/<%- id %>/download" >
            <i class="fa fa-download"></i>download
          </a> <br />
        <% } %>
        <a href="#" class="delete">
          <i class="fa fa-trash-o"></i>delete
        </a>
      </td>
    </tr>
    <tr class="details-row hide">
      <td colspan="12">
        <table class="table table-condensed table-nohead">
          <tbody></tbody>
        </table>
      </td>
    </tr>
  """)

  childView : SimpleTaskItemView
  childViewContainer : "tbody"
  tagName : "tbody"

  events :
    "click .details-toggle" : "toggleDetails"
    "click .delete" : "deleteTaskType"

  ui :
    "detailsRow" : ".details-row"
    "detailsToggle" : ".details-toggle"


  initialize : ->

    @listenTo(app.vent, "taskTypeListView:toggleDetails", @toggleDetails)
    @collection = new TaskCollection(null, taskTypeId : @model.get("id"))

    # minimize the toggle view on item deletion
    @listenTo(@collection, "remove", (item) =>
      @toggleDetails()
    )


  deleteTaskType : (evt) ->

    evt.preventDefault()

    if window.confirm("Do you really want to delete this task type?")
      @model.destroy().done((response) =>
        Toast.message(response.messages)
      )

  toggleDetails : ->

    if @ui.detailsRow.hasClass("hide")

      @collection
        .fetch(silent : true)
        .done( =>
          @render()
          @ui.detailsRow.removeClass("hide")
          @ui.detailsToggle.addClass("open")
        )
    else
      @ui.detailsRow.addClass("hide")
      @ui.detailsToggle.removeClass("open")


module.exports = TaskTypeItemView
