_                         = require("lodash")
Marionette                = require("backbone.marionette")
DashboardTaskListItemView = require("./dashboard_task_list_item_view")
TaskTransferModalView     = require("./task_transfer_modal_view")
routes                    = require("routes")
Toast                     = require("libs/toast")
SortTableBehavior         = require("libs/behaviors/sort_table_behavior")
UserTasksCollection       = require("../models/user_tasks_collection")

class DashboardTaskListView extends Marionette.CompositeView

  template : _.template("""
    <h3>Tasks</h3>
    <% if (isAdminView) { %>
      <a href="<%- jsRoutes.controllers.NMLIOController.userDownload(id).url %>"
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
      Show <%= getFinishVerb() %> tasks only
    </a>
    <table class="table table-striped sortable-table">
      <thead>
        <tr>
          <th data-sort="formattedHash"># </th>
          <th data-sort="type.summary">Type </th>
          <th data-sort="projectName">Project </th>
          <th data-sort="type.description">Description </th>
          <th>Modes </th>
          <th data-sort="created">Created</th>
          <th></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <div class="modal-container"></div>
  """)

  childViewContainer : "tbody"
  childView : DashboardTaskListItemView
  childViewOptions : ->
    isAdminView : @options.isAdminView


  templateContext : ->
    isAdminView : @options.isAdminView
    getFinishVerb : =>
      return if @showFinishedTasks then "unfinished" else "finished"


  ui :
    "modalContainer" : ".modal-container"

  events :
    "click #new-task-button" : "newTask"
    "click #transfer-task" : "transferTask"
    "click #toggle-finished" : "toggleFinished"

  behaviors:
    SortTableBehavior:
      behaviorClass: SortTableBehavior


  initialize : (@options) ->

    @showFinishedTasks = false
    @collection = new UserTasksCollection([], userID : @options.userID)
    @collection.fetch()

    @listenTo(app.vent, "modal:destroy", @refresh)

  filter : (child) ->
    if @showFinishedTasks
      return child.get("annotation.state.isFinished")
    else
      return !child.get("annotation.state.isFinished")

  newTask : (event) ->

    event.preventDefault()

    if @collection.filter(UserTasksCollection::unfinishedTasksFilter).length == 0 or confirm("Do you really want another task?")

      @collection.getNewTask()


  toggleFinished : ->

    @showFinishedTasks = not @showFinishedTasks
    @collection.isFinished = @showFinishedTasks
    @refresh()


  transferTask : (evt) ->

    evt.preventDefault()

    modalContainer = new Backbone.Marionette.Region(
      el : @ui.modalContainer
    )
    url = evt.target.href
    @modal = new TaskTransferModalView(url : url)
    modalContainer.show(@modal)


  refresh : ->

    @collection.fetch().then( =>
      @render()
    )

  onDestroy : ->

    @modal?.destroy()


module.exports = DashboardTaskListView
