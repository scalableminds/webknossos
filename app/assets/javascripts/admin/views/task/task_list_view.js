_                       = require("lodash")
app                     = require("app")
Marionette              = require("backbone.marionette")
Toast                   = require("libs/toast")
Utils                   = require("libs/utils")
TaskListItemView        = require("./task_list_item_view")
AnonymousTaskLinkModal  = require("./anonymous_task_link_modal")

class TaskListView extends Marionette.CompositeView

  template : _.template("""
    <h3><%- getTitle() %></h3>
    <table id="tasklist-table" class="table table-double-striped table-details">
      <thead>
        <tr>
          <th class="details-toggle-all"><i class="caret-right"></i><i class="caret-down"></i></th>
          <th>#</th>
          <th>Team</th>
          <th>Project</th>
          <th>Type</th>
          <th>DataSet</th>
          <th>Edit position /<br> Bounding Box</th>
          <th>Experience</th>
          <th>Created</th>
          <th>Stats</th>
          <th>Actions</th>
         </tr>
      </thead>
    </table>
    <div id="modal-wrapper"></div>
  """)

  className : "task-administration container wide"
  childView : TaskListItemView
  childViewContainer : "table"

  ui :
    "modal" : ".modal"
    "inputName" : "#inputName"
    "detailsToggle" : ".details-toggle-all"
    "modalWrapper" : "#modal-wrapper"

  events :
    "click #new-team" : "showModal"
    "click .modal .btn-primary" : "addNewTeam"
    "click @ui.detailsToggle" : "toggleAllDetails"

  templateContext : ->
    getTitle : =>
      if name = @collection.fullCollection.projectName
        return "Tasks for Project #{name}"
      else if id = @collection.fullCollection.taskTypeId
        return "Tasks for TaskType #{id}"


  initialize : ->

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "paginationView:addElement", @createNewTask)
    @listenTo(@collection, "sync", @showAnonymousLinks)

    @collection.fetch()


  createNewTask : ->

    if name = @collection.fullCollection.projectName
      urlParam = "?projectName=#{name}"
    else if id = @collection.fullCollection.taskTypeId
      urlParam = "?taskType=#{id}"
    else
      urlParam = ""

    # The trailing '#' is important for routing
    app.router.navigate("/tasks/create#{urlParam}#", {trigger : true})


  toggleAllDetails : ->

    @ui.detailsToggle.toggleClass("open")
    app.vent.trigger("taskListView:toggleDetails")


  showAnonymousLinks : ->

    anonymousTaskId = Utils.getUrlParams("showAnonymousLinks")
    return unless anonymousTaskId

    task = @collection.findWhere(id : anonymousTaskId)
    if task and task.get("directLinks")
      @showModal(task)
    else
      Toast.error("Unable to find anonymous links for task #{anonymousTaskId}.")


  showModal : (task) ->

    modalView = new AnonymousTaskLinkModal({model : task})
    modalView.render()
    @ui.modalWrapper.html(modalView.el)

    modalView.show()
    @modalView = modalView


  onDestroy : ->

    @modalView?.destroy()


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["team", "projectName", "id", "dataSet", "created"], searchQuery)

module.exports = TaskListView
