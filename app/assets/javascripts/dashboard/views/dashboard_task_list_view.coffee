_                         = require("lodash")
marionette                = require("backbone.marionette")
DashboardTaskListItemView = require("./dashboard_task_list_item_view")
TaskTransferModalView     = require("./task_transfer_modal_view")
routes                    = require("routes")
Toast                     = require("libs/toast")
SortTableBehavior         = require("libs/behaviors/sort_table_behavior")
UserTasksCollection       = require("../models/user_tasks_collection")

class DashboardTaskListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Tasks</h3>
    <% if (isAdminView) { %>
      <a href="<%= jsRoutes.controllers.admin.NMLIO.userDownload(id).url %>"
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
      Show finished tasks only
    </a>
    <table class="table table-striped sortable-table">
      <thead>
        <tr>
          <th data-sort="formattedHash"># </th>
          <th data-sort="type.summary">Type </th>
          <th data-sort="projectName">Project </th>
          <th data-sort="type.description">Description </th>
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
    isAdminView : @options.isAdminView


  templateHelpers : ->
    isAdminView : @options.isAdminView


  childViewContainer : "tbody"

  ui :
    "finishToggle" : "#toggle-finished"
    "modalContainer" : ".modal-container"

  events :
    "click #new-task-button" : "newTask"
    "click #transfer-task" : "transferTask"
    "click @ui.finishToggle" : "toggleFinished"

  behaviors:
    SortTableBehavior:
      behaviorClass: SortTableBehavior


  initialize : (@options) ->

    @showFinishedTasks = false
    @collection = new UserTasksCollection()
    @collection.fetch()

    @filter = UserTasksCollection::unfinishedTasksFilter

    #@listenTo(@model.get("tasks"), "add", @addChildView, @)
    @listenTo(app.vent, "TaskTransferModal:refresh", @refresh)


  update : ->

    @filter =
      if @showFinishedTasks
        UserTasksCollection::finishedTasksFilter
      else
        UserTasksCollection::unfinishedTasksFilter

    @render()


  newTask : (event) ->

    event.preventDefault()

    if @collection.filter(UserTasksCollection::unfinishedTasksFilter).length == 0 or confirm("Do you really want another task?")

      showMessages = (response) -> Toast.message(response.messages)

      @collection.getNewTask().done((response) =>
        showMessages(response)
        @update()
      )


  toggleFinished : ->

    @showFinishedTasks = not @showFinishedTasks
    @update()

    verb = if @showFinishedTasks then "unfinished" else "finished"
    @ui.finishToggle.html("Show #{verb} tasks only")


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


module.exports = DashboardTaskListView
