_                = require("lodash")
Marionette       = require("backbone.marionette")
TaskListView     = require("./task_list_view.coffee")
TaskCollection   = require("admin/models/task/task_collection")
Request          = require("libs/request")

class TaskQueryView extends Marionette.LayoutView

  template : _.template("""
    <div class="container wide">
      <h3>Query Tasks</h3>

      <div class="row">
        <div class="col-sm-9">
          <input type="text" class="form-control" id="query"/>
        </div>
        <div class="col-sm-3">
          <a class="btn btn-primary search-button" href="#">
            <i class="fa fa-plus"></i>Search
          </a>
        </div>
      </div>
    </div>
    <div class="taskList"></div>
  """)

  regions :
    "taskListRegion" : ".taskList"

  ui :
    "taskList" : ".taskList"
    "query" : "#query"

  events :
    "click .search-button" : "search"

  onRender : ->

    @collection = new TaskCollection(null, {addButtonText : "Create New Task"})
    @taskListView = new TaskListView({collection: @collection})

    @taskListRegion.show(@taskListView)
    app.router.hideLoadingSpinner()
    @ui.query.val("{isActive: true}")

  search : ->

    queryString = @ui.query.val()
    try
      queryObject = JSON.parse(queryString)
    catch e
      # This is an eval hack in order to allow JSON without quoted keys.
      # JS is only executed locally so it doesn't yield more power than the
      # browser console.
      queryObject = eval("(function() { return eval(" + queryString + "); })()")

    Request.sendJSONReceiveJSON(
      "/api/queries"
      {
        params : {type : "task"}
        data : queryObject
      }
    ).then((result) =>
      @collection.reset()
      @collection.addObjects(result)
    )


module.exports = TaskQueryView
