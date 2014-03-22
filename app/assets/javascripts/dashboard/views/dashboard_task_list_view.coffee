### define
underscore : _
backbone.marionette : marionette
app : app
dashboard/views/dashboard_task_list_item_view : DashboardTaskListItemView
routes : routes
###

class DashboardTaskListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Tasks</h3>
    <br />
    <% if (this.isAdminView) { %>
      <a href="<%= jsRoutes.controllers.admin.NMLIO.userDownload(user.id).url %>"
         title="download all finished tracings">
          <i class="fa fa-download"></i>download
      </a>
    <% } else { %>
      <a href="<%= jsRoutes.controllers.TaskController.request().url %>"
         class="btn btn-success"
         data-ajax="add-row=#dashboard-tasks<% if(hasAnOpenTask) { %>,confirm=@Messages("task.requestAnother") <% } %>"
         id="new-task-button">
         Get a new task
      </a>
    <% } %>
    <div class="divider-vertical"></div>
    <a href="#" id="toggle-finished">Show finished tasks</a>
    <br /><br />
    <table class="table table-striped mask-finished" id="dashboard-tasks">
      <thead>
        <tr>
          <th> # </th>
          <th> Type </th>
          <th> Project </th>
          <th> Description </th>
          <th> Modes </th>
          <th> </th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  """)

  itemView : DashboardTaskListItemView
  itemViewContainer : "tbody"

  events :
    "click #new-task-button" : "newTask"
    "click #toggle-finished" : "toggleFinished"

  modelEvents :
    "change:filteredTasks" : "update"

  isAdminView : false

  initialize : (options) ->

    @model = options.model
    @collection = @model.get("filteredTasks")

  update : ->

    @collection = @model.get("filteredTasks")
    @render()


  newTask : ->

    console.log("fetching new task")


  toggleFinished : ->

    showFinishedTasks = !@model.get("showFinishedTasks")
    @model.set("showFinishedTasks", showFinishedTasks)
