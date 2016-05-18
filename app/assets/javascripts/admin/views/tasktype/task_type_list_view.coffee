_                = require("lodash")
app              = require("app")
Marionette       = require("backbone.marionette")
TaskTypeItemView = require("./task_type_item_view")

class TaskTypeListView extends Marionette.CompositeView

  template : =>
    _.template("""
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
      </table>
    """)

  childView : TaskTypeItemView
  childViewContainer: "table"


  initialize : ->

    @collection.fetch()


module.exports = TaskTypeListView
