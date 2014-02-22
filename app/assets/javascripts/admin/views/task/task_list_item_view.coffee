### define
underscore : _
app : app
backbone.marionette : marionette
./task_list_subitem_view: TaskListSubitemView
###

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
      <a href="/admin/projects#<%= projectName %>">
        <%= projectName %>
      </a>
    </td>
    <td>
      <a href="/admin/taskTypes#<% if(type) { print(type.summary)  } else { print('<deleted>') } %>">
        <% if(type) { print(type.summary)  } else { print("<deleted>") } %>
      </a>
    </td>
    <td><%= dataSet %></td>
    <td>(<%= editPosition %>)</td>
    <td>
      <% if (neededExperience.domain != "" || neededExperience.value > 0) { %>
        <span class="label"><%= neededExperience.domain %> : <%= neededExperience.value %></span>
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
      <a href="/annotations/CompoundTask/<%= id %>" title="view all finished tracings"><i class="fa fa-random"></i>view</a><br>
      <a href="/admin/tasks/<%= id %>/download" title="download all finished tracings"><i class="fa fa-download"></i>download</a><br>
      <a href="#" class="delete"><i class="fa fa-trash-o"></i>delete</a>
    </td>
    </tr>
    <tr class="details-row hide" >
      <td colspan="12">
        <table class="table table-condensed table-nohead">
          <tbody>
          </tbody>
        </table>
      </td>
    </tr>
  """)

  itemView : TaskListSubitemView
  itemViewContainer : "tbody"

  events :
    "click .delete" : "delete"
    "click .details-toggle" : "toggleDetails"

  ui :
    "detailsRow" : ".details-row"
    "detailsToggle" : ".details-toggle"


  initialize :->

    @listenTo(app.vent, "taskListView:toggleDetails", @toggleDetails)


  delete : ->

    @model.destroy()


  toggleDetails : ->

    if @ui.detailsRow.hasClass("hide")
      @collection = new Backbone.Collection()
      @collection.url= """/admin/tasks/#{@model.get("id")}/annotations"""
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

