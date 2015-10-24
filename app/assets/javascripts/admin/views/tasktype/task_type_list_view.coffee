_                = require("lodash")
app              = require("app")
marionette       = require("backbone.marionette")
TaskTypeItemView = require("./task_type_item_view")

class TaskTypeListView extends Backbone.Marionette.CompositeView

  template : =>
    _.template("""
      <table class="table table-double-striped table-details" id="tasktype-table">
        <thead>
          <tr>
            <th class="details-toggle-all"> <i class="caret-right"></i><i class="caret-down"></i></th>
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

  ui:
    "detailsToggle" : ".details-toggle-all"

  events:
    "click @ui.detailsToggle" : "toggleAllDetails"


  initialize : ->

    @collection.fetch()


  toggleAllDetails : ->

    @ui.detailsToggle.toggleClass("open")
    app.vent.trigger("taskTypeListView:toggleDetails")

module.exports = TaskTypeListView
