### define
underscore : _
backbone.marionette : marionette
./dashboard_task_list_item_view : DashboardTaskListItemView
routes : routes
libs/toast : Toast
###

class DashboardTaskListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Tasks</h3>
    <% if (isAdminView) { %>
      <a href="<%= jsRoutes.controllers.admin.NMLIO.userDownload(user.id).url %>"
         class="btn btn-primary"
         title="download all finished tracings">
          <i class="fa fa-download"></i>download
      </a>
    <% } else { %>
      <a href="#"
         class="btn btn-success"
         id="new-task-button">
         Get a new task
      </a>
    <% } %>
    <div class="divider-vertical"></div>
    <a href="#" id="toggle-finished" class="btn btn-default">
      Show finished tasks
    </a>
    <table class="table table-striped">
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

  childView : DashboardTaskListItemView
  childViewContainer : "tbody"

  ui :
    "finishToggle" : "#toggle-finished"

  events :
    "click #new-task-button" : "newTask"
    "click @ui.finishToggle" : "toggleFinished"


  initialize : (options) ->

    @showFinishedTasks = false
    @collection = @model.getUnfinishedTasks()

    @listenTo(@model.get("tasks"), "add", @addChildView, @)
    @listenTo(@model.get("tasks"), "change", @update)


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

      showMessages = (response) -> Toast.message(response.messages)

      @model.getNewTask().done((response) =>
        showMessages(response)
        @update()
      ).fail((xhr) ->
        showMessages(xhr.responseJSON)
      )


  toggleFinished : ->

    @showFinishedTasks = not @showFinishedTasks
    @update()

    verb = if @showFinishedTasks then "Hide" else "Show"
    @ui.finishToggle.html("#{verb} finished tasks")
