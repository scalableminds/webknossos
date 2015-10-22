_                    = require("lodash")
app                  = require("app")
marionette           = require("backbone.marionette")
AnnotationCollection = require("admin/models/task/annotation_collection")
TaskAnnotationView   = require("./task_annotation_view")

class TaskListItemView extends Backbone.Marionette.CompositeView

  tagName : "tbody"
  attributes : ->
    id : @model.get("id")

  template : _.template("""
    <tr>
      <td class="details-toggle" href="#">
        <i class="caret-right"></i>
        <i class="caret-down"></i>
      </td>
      <td><%= formattedHash %></td>
      <td><%= team %></td>
      <td>
        <a href="/projects#<%= projectName %>">
          <%= projectName %>
        </a>
      </td>
      <td>
        <a href="/admin/taskTypes#<%= type.summary %>">
          <%= type.summary %>
        </a>
      </td>
      <td><%= dataSet %></td>
      <td>(<%= editPosition %>)</td>
      <td>(<%= boundingBox.join(", ") %>)</td>
      <td>
        <% if (neededExperience.domain != "" || neededExperience.value > 0) { %>
          <span class="label label-default"><%= neededExperience.domain %> : <%= neededExperience.value %></span>
        <% } %>
      </td>
      <td><%= priority %></td>
      <td><%= created %></td>
      <td>
        <i class="fa fa-play-circle"></i><%= status.open %><br>
        <i class="fa fa-random"></i><%= status.inProgress %><br>
        <i class="fa fa-check-circle-o"></i><%= status.completed %>
      </td>
      <td class="nowrap">
        <a href="/admin/tasks/<%= id %>/edit"><i class="fa fa-pencil"></i>edit</a><br>
        <% if (status.completed > 0) { %>
          <a href="/annotations/CompoundTask/<%= id %>" title="view all finished tracings"><i class="fa fa-random"></i>view</a><br>
          <a href="/api/tasks/<%= id %>/download" title="download all finished tracings"><i class="fa fa-download"></i>download</a><br>
        <% } %>
        <a href="#" class="delete"><i class="fa fa-trash-o"></i>delete</a>
      </td>
    </tr>
    <tr class="details-row hide" >
      <td colspan="13">
        <table class="table table-condensed table-nohead table-hover">
          <tbody>
          </tbody>
        </table>
      </td>
    </tr>
  """)

  childView : TaskAnnotationView
  childViewContainer : "tbody"

  events :
    "click .delete" : "deleteTask"
    "click .details-toggle" : "toggleDetails"

  ui :
    "detailsRow" : ".details-row"
    "detailsToggle" : ".details-toggle"


  initialize :->

    @listenTo(app.vent, "taskListView:toggleDetails", @toggleDetails)
    @collection = new AnnotationCollection(@model.get("id"))

    # minimize the toggle view on item deletion
    @listenTo(@collection, "remove", (item) =>
      @toggleDetails()
    )


  deleteTask : ->

    if window.confirm("Do you really want to delete this task?")
      @model.destroy()


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

module.exports = TaskListItemView
