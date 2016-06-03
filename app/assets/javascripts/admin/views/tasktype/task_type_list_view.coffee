_                     = require("lodash")
app                   = require("app")
Marionette            = require("backbone.marionette")
TaskTypeListItemView  = require("./task_type_list_item_view")

class TaskTypeListView extends Marionette.CompositeView

  template : =>
    _.template("""
      <h3>Task Types</h3>
      <table class="table table-striped table-details" id="tasktype-table">
        <thead>
          <tr>
            <th> # </th>
            <th> Team </th>
            <th> Summary </th>
            <th> Description </th>
            <th> Add-On Modes </th>
            <th> Settings </th>
            <th> Expected Time </th>
            <th> Attached File </th>
            <th></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    """)

  className : "container wide task-types-administration"
  childView : TaskTypeListItemView
  childViewContainer: "tbody"


  initialize : ->

    @collection.fetch()

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "paginationView:addElement", @createNewTaskType)


  createNewTaskType : ->

    app.router.navigate("/taskTypes/create", {trigger : true})


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["summary", "team", "description", "id"], searchQuery)


module.exports = TaskTypeListView
