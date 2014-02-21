### define
underscore : _
backbone.marionette : marionette
./task_list_item_view : TaskListItemView
###

class TaskListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Tasks</h3>
    <table id="tasklist-table" class="table table-double-striped table-details">
      <thead>
        <tr>
          <th class="details-toggle-all"> <i class="caret-right"></i><i class="caret-down"></i></th>
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
  """)
  className : "task-administration container wide"
  itemView : TaskListItemView
  itemViewContainer : "table"

  ui :
    "modal" : ".modal"
    "inputName" : "#inputName"

  events :
    "click #new-team" : "showModal"
    "click .modal .btn-primary" : "addNewTeam"

  initialize : ->

    @listenTo(app.vent, "paginationView:filter", @filter)

    @collection.fetch(
      silent : true #fucking important
    ).done( =>
      @collection.goTo(1)
    )


  filter : (searchQuery) ->

    @collection.setFilter(["team", "projectName", "id", "dataSet", "priority", "created"], searchQuery)