### define
underscore : _
backbone.marionette : marionette
libs/toast : Toast
./simple_task_item_view : SimpleTaskItemView
admin/models/task/task_collection : TaskCollection
###

class TaskTypeItemView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <tr id="<%= id %>">
      <td class="details-toggle" href="#">
        <i class="caret-right"></i>
        <i class="caret-down"></i>
      </td>
      <td><%= formattedHash %></td>
      <td><%= team %></td>
      <td><%= summary %></td>
      <td><%= formattedShortText %></td>
      <td>
        <% _.each(settings.allowedModes, function (mode) { %>
          <span class="label label-default"><%= mode[0].toUpperCase() + mode.slice(1) %></span>
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
      <td><%= expectedTime  %></td>
      <td><%= fileName %></td>
      <td class="nowrap">
        <a href="/annotations/CompoundTaskType/<%= id %>" title="view all finished tracings">
          <i class="fa fa-random"></i>view
        </a> <br />
        <a href="/admin/taskTypes/<%= id %>/edit" >
          <i class="fa fa-pencil"></i>edit
        </a> <br />
        <a href="/admin/taskTypes/<%= id %>/delete" data-ajax="delete-row,confirm">
          <i class="fa fa-trash-o"></i>delete
        </a>
      </td>
    </tr>
    <tr class="details-row hide">
      <td colspan="12">
        <table class="table table-condensed table-nohead">
          <tbody> <!-- class="hide" -->
            <!-- TASKS FOR TASKTYPE NEED TO BE LOADED INTO THIS TABLE -->
          </tbody>
        </table>
      </td>
    </tr>
  """)

  itemView : SimpleTaskItemView
  itemViewContainer : "tbody"
  tagName : "tbody"

  events :
    "click .details-toggle" : "toggleDetails"

  ui :
    "detailsRow" : ".details-row"
    "detailsToggle" : ".details-toggle"


  initialize :->

    @listenTo(app.vent, "taskTypeListView:toggleDetails", @toggleDetails)
    @collection = new TaskCollection(@model.get("id"))

    # minimize the toggle view on item deletion
    @listenTo(@collection, "remove", (item) =>
      @toggleDetails()
    )


  toggleDetails : ->

    if @ui.detailsRow.hasClass("hide")

      @collection
        .fetch()
        .done( =>
          @render()
          @ui.detailsRow.removeClass("hide")
          @ui.detailsToggle.addClass("open")
        )
    else
      @ui.detailsRow.addClass("hide")
      @ui.detailsToggle.removeClass("open")
