### define
underscore : _
backbone.marionette : marionette
./dashboard_task_list_item_view : DashboardTaskListItemView
dashboard/models/dashboard_task_model : DashboardTaskModel
routes : routes
libs/toast : Toast
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

  isAdminView : false

  initialize : ->

    @showFinishedTasks = false
    @collection = @model.getUnfinishedTasks()
    @listenTo(@model.get("tasks"), "add", @addChildView, @)

  update : ->

    @collection =
      if @showFinishedTasks
        @model.getFinishedTasks()
      else
        @model.getUnfinishedTasks()

    @render()


  newTask : (event) ->

    event.preventDefault()


    if @model.getUnfinishedTasks().length == 0 or confirm("Do you really want another task?")

      newTask = new DashboardTaskModel()
      newTask.fetch(
        url : "/user/tasks/request"
        success : =>
          console.log "success ", newTask
          @model.get("tasks").add(newTask)

        error : (model, xhr) ->
          Toast.message(xhr.responseJSON.messages)
      )


  toggleFinished : ->

    @showFinishedTasks = not @showFinishedTasks
    @update()
