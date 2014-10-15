### define
underscore : _
backbone.marionette : marionette
./dashboard_task_list_item_view : DashboardTaskListItemView
./task_transfer_modal_view : TaskTransferModalView
../models/user_tasks_collection : UserTasksCollection
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
          <th># </th>
          <th>Type </th>
          <th>Project </th>
          <th>Description </th>
          <th>Modes </th>
          <th></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <div class="modal-container"></div>
  """)

  childView : DashboardTaskListItemView
  childViewOptions : ->
    isAdminView : @isAdminView

  templateHelpers : ->
    isAdminView : @isAdminView


  childViewContainer : "tbody"

  ui :
    "finishToggle" : "#toggle-finished"
    "modalContainer" : ".modal-container"

  events :
    "click #new-task-button" : "newTask"
    "click #transfer-task" : "transferTask"
    "click @ui.finishToggle" : "toggleFinished"


  initialize : (options) ->

    @showFinishedTasks = false
    @isAdminView = options.isAdminView
    @collection = new UserTasksCollection()

    #@listenTo(@model.get("tasks"), "add", @addChildView, @)
    @listenTo(app.vent, "TaskTransferModal:refresh", @refresh)


  update : ->

    @collection =
      if @showFinishedTasks
        @collection.getFinishedTasks()
      else
        @collection.getUnfinishedTasks()

    @render()


  newTask : (event) ->

    event.preventDefault()

    if @collection.getUnfinishedTasks().length == 0 or confirm("Do you really want another task?")

      showMessages = (response) -> Toast.message(response.messages)

      @collection.getNewTask().done((response) =>
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


  transferTask : (evt) ->

    evt.preventDefault()

    modalContainer = new Backbone.Marionette.Region(
      el : @ui.modalContainer
    )
    url = evt.target.href
    @modal = new TaskTransferModalView(url : url)
    modalContainer.show(@modal)


  refresh : ->

    @collection.fetch().done( =>
      @update()
    )

  onDestroy : ->

    @modal?.destroy()
