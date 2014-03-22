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
      <a href="<%= jsRoutes.controllers.TaskController.request().url %>" title="download all finished tracings">
        <i class="fa fa-download"></i>download
      </a>
    <% } else { %>
      <a href="<%= jsRoutes.controllers.admin.NMLIO.userDownload(user.id).url %>"
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

  isAdminView : false

  initialize : (options) ->

    console.log "options", options
    @model = options.model

    @collection = @model.get("tasks")


  newTask : ->

    console.log("fetching new task")
