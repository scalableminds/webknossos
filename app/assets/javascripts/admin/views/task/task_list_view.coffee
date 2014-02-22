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
          <th> # </th>
          <th> Team</th>
          <th> Project</th>
          <th> Type</th>
          <th> DataSet </th>
          <th> Edit position </th>
          <th> Experience </th>
          <th> Priority </th>
          <th> Created </th>
          <th> States </th>
         </tr>
      </thead>
    </table>
    <div class="form-actions navbar-fixed-bottom">
      <div class="btn-group">
        <a class="btn btn-primary" href="/admin/tasks/create">
          <i class="fa fa-tasks"></i>Create New Task
        </a>
      </div>
    </div>
  """)
  className : "task-administration container wide"
  itemView : TaskListItemView
  itemViewContainer : "table"

  ui :
    "modal" : ".modal"
    "inputName" : "#inputName"
    "detailsToggle" : ".details-toggle-all"

  events :
    "click #new-team" : "showModal"
    "click .modal .btn-primary" : "addNewTeam"
    "click .details-toggle-all" : "toggleAllDetails"

  initialize : ->

    @listenTo(app.vent, "paginationView:filter", @filter)

    @collection.fetch(
      silent : true #fucking important for pagination
    ).done( =>
      @collection.goTo(1)
    )


  toggleAllDetails : ->

    @ui.detailsToggle.toggleClass("open")
    app.vent.trigger  ("taskListView:toggleDetails")


  filter : (searchQuery) ->

    @collection.setFilter(["team", "projectName", "id", "dataSet", "priority", "created"], searchQuery)
