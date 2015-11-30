### define
underscore : _
app : app
backbone.marionette : marionette
./task_list_item_view : TaskListItemView
###

class TaskListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Tasks</h3>
    <table id="tasklist-table" class="table table-double-striped table-details">
      <thead>
        <tr>
          <th class="details-toggle-all"><i class="caret-right"></i><i class="caret-down"></i></th>
          <th>#</th>
          <th>Team</th>
          <th>Project</th>
          <th>Type</th>
          <th>DataSet </th>
          <th>Edit position</th>
          <th>Bounding Box</th>
          <th>Experience</th>
          <th>Priority</th>
          <th>Created</th>
          <th>States</th>
          <th>Actions</th>
         </tr>
      </thead>
    </table>
  """)
  className : "task-administration container wide"
  childView : TaskListItemView
  childViewContainer : "table"

  ui :
    "modal" : ".modal"
    "inputName" : "#inputName"
    "detailsToggle" : ".details-toggle-all"

  events :
    "click #new-team" : "showModal"
    "click .modal .btn-primary" : "addNewTeam"
    "click @ui.detailsToggle" : "toggleAllDetails"

  initialize : ->

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "paginationView:addElement", @createNewTask)

    @collection.fetch(
      silent : true #fucking important for pagination
    ).done( =>
      @collection.goTo(1)
    )


  createNewTask : ->

    app.router.loadURL("/admin/tasks/create")


  toggleAllDetails : ->

    @ui.detailsToggle.toggleClass("open")
    app.vent.trigger("taskListView:toggleDetails")


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["team", "projectName", "id", "dataSet", "priority", "created"], searchQuery)
