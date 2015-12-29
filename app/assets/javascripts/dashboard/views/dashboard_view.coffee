_                          = require("lodash")
marionette                 = require("backbone.marionette")
DashboardTaskListView      = require("./dashboard_task_list_view")
ExplorativeTracingListView = require("./explorative_tracing_list_view")
LoggedTimeView             = require("./logged_time_view")
DatasetSwitchView          = require("./dataset/dataset_switch_view")


class DashboardView extends Backbone.Marionette.LayoutView

  className : "container wide"
  id : "dashboard"
  template : _.template("""
    <% if (isAdminView) { %>
      <h3>User: <%- firstName %> <%- lastName %></h3>
    <% } %>
    <div class="tabbable" id="tabbable-dashboard">
      <ul class="nav nav-tabs">
        <% if (!isAdminView) { %>
          <li class="active">
            <a href="#" id="tab-datasets" data-toggle="tab">Datasets</a>
          </li>
        <% } %>
        <li <% if (isAdminView) { %> class="active" <% } %> >
          <a href="#" id="tab-tasks" data-toggle="tab">Tasks</a>
        </li>
        <li>
          <a href="#" id="tab-explorative" data-toggle="tab">Explorative Annotations</a>
        </li>
        <li>
          <a href="#" id="tab-logged-time" data-toggle="tab">Tracked Time</a>
        </li>
      </ul>
      <div class="tab-content">
        <div class="tab-pane active"></div>
      </div>
    </div>
  """)

  regions :
    "tabPane" : ".tab-pane"


  events :
    "click #tab-datasets" : "showDatasets"
    "click #tab-tasks" : "showTasks"
    "click #tab-explorative" : "showExplorative"
    "click #tab-logged-time" : "showLoggedTime"


  templateHelpers : ->
    isAdminView : @options.isAdminView


  initialize : (@options) ->

    if @options.isAdminView
      @listenTo(@, "render", @showTasks)
    else
      @listenTo(@, "render", @showDatasets)

    @viewCache =
      datasetSwitchView : null
      taskListView : null
      explorativeTracingListView : null
      loggedTimeView : null


  showDatasets : ->

    @showTab("datasetSwitchView", DatasetSwitchView)


  showTasks : ->

    @showTab("taskListView", DashboardTaskListView)


  showExplorative : ->

    @showTab("explorativeTracingListView", ExplorativeTracingListView)


  showLoggedTime : ->

    @showTab("loggedTimeView", LoggedTimeView)


  showTab : (viewName, viewClass) ->

    unless view = @viewCache[viewName]
      view = @viewCache[viewName] = new viewClass(@options)
    @tabPane.show(view, preventDestroy : true)


module.exports = DashboardView
