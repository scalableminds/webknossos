_                = require("lodash")
Marionette       = require("backbone.marionette")
TaskListView     = require("./task_list_view.coffee")
TaskCollection   = require("admin/models/task/task_collection")
Request          = require("libs/request")
admin            = require("admin/admin")
Toast            = require("libs/toast")
PaginationCollection  = require("admin/models/pagination_collection")
TaskQueryDocumentationModal = require("./task_query_documentation_modal")
ace              = require("brace")
require('brace/mode/javascript');
require('brace/mode/json');
require('brace/theme/clouds');

class TaskQueryView extends Marionette.LayoutView

  template : _.template("""
    <div class="container wide">
      <h3>Tasks</h3>

      <div class="row">
          <div id="query" style="width: 500px; height: 100px; display: inline-block"></div>
          <div style="vertical-align: top; display: inline-block">
            <a class="btn btn-primary search-button" href="#">
              <i class="fa fa-search"></i>Search
            </a>
            <a class="btn btn-default documentation-button" href="#">
              <i class="fa fa-question-circle"></i>Documentation
            </a>
          </div>
      </div>
      <hr>
    </div>
    <div class="paginator"></div>
    <div class="taskList"></div>
    <div id="modal-wrapper"></div>
  """)

  regions :
    "paginatorRegion" : ".paginator"
    "taskListRegion" : ".taskList"

  ui :
    "taskList" : ".taskList"
    "query" : "#query"
    "modalWrapper" : "#modal-wrapper"

  events :
    "click .search-button" : "search"
    "click .documentation-button" : "showDocumentation"

  onRender : ->

    @collection = new TaskCollection(null, {addButtonText : "Create New Task"})
    paginatedCollection = new PaginationCollection([], fullCollection : @collection)
    @taskListView = new TaskListView({collection: paginatedCollection})

    app.router.hideLoadingSpinner()

    paginationView = new admin.PaginationView({collection : paginatedCollection, addButtonText : "Create New Task"})

    @taskListRegion.show(@taskListView)
    @paginatorRegion.show(paginationView)

    @documentationModal = new TaskQueryDocumentationModal()
    @documentationModal.render()
    @ui.modalWrapper.html(@documentationModal.el)

    @editor = ace.edit(@ui.query[0])
    @editor.getSession().setMode('ace/mode/javascript')
    @editor.setTheme('ace/theme/clouds')

    @editor.setValue("{\n\tisActive: true\n}")
    @editor.clearSelection()


  search : ->

    queryString = @editor.getValue()
    try
      queryObject = JSON.parse(queryString)
    catch e
      try
        # This is an eval hack in order to allow JSON without quoted keys.
        # JS is only executed locally so it doesn't yield more power than the
        # browser console.
        queryObject = eval("(function() { return eval(" + queryString + "); })()")
      catch e
        Toast.error("The task query couldn't be parsed. Ensure that the query is valid JSON.")


    Request.sendJSONReceiveJSON(
      "/api/queries"
      {
        params : {type : "task"}
        data : queryObject
      }
    ).then((result) =>
      @collection.reset()
      defaultQueryLimit = 100
      if result.length == defaultQueryLimit
        Toast.warning("Not all results are shown because there are too many. Results are limited #{defaultQueryLimit} entries.")
      @collection.addObjects(result)
    )

  showDocumentation : ->

    @documentationModal.$el.modal("show")

module.exports = TaskQueryView
