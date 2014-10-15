### define
underscore : _
backbone.marionette : marionette
dashboard/views/dashboard_task_list_view : DashboardTaskListView
dashboard/views/explorative_tracing_list_view : ExplorativeTracingListView
dashboard/views/logged_time_view : LoggedTimeView
admin/views/dataset/dataset_switch_view : DatasetSwitchView
###

class DashboardView extends Backbone.Marionette.LayoutView

  className : "container wide"
  id : "dashboard"
  template : _.template("""
    <% if (isAdminView) { %>
      <h3>User: <%= user.get("firstName") %> <%= user.get("lastName") %></h3>
    <% } %>
    <div class="tabbable" id="tabbable-dashboard">
      <ul class="nav nav-tabs">
        <li class="active">
          <a href="#" id="tab-datasets" data-toggle="tab">Datasets</a>
        </li>
        <li>
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

  ui :
    "tabPane" : ".tab-pane"


  events :
    "click #tab-datasets" : "showDatasets"
    "click #tab-tasks" : "showTasks"
    "click #tab-explorative" : "showExplorative"
    "click #tab-logged-time" : "showLoggedTime"


  regions :
    "tabPane" : ".tab-pane"


  initialize : (options) ->

    @options = options
    @viewCache =
      datasetSwitchView : null
      taskListView : null
      explorativeTracingListView : null
      loggedTimeView : null

    @listenTo(@, "render", @showDatasets)


  serializeData : ->

    return @options


  showDatasets : ->

    unless view = @viewCache["datasetSwitchView"]
      view = @viewCache["datasetSwitchView"] = new DatasetSwitchView(@options)
    @tabPane.show(view, preventDestroy : true)


  showTasks : ->

    unless view = @viewCache["taskListView"]
      view = @viewCache["taskListView"] = new DashboardTaskListView(@options)
    @tabPane.show(view, preventDestroy : true)


  showExplorative : ->

    unless view = @viewCache["explorativeTracingListView"]
      view = @viewCache["explorativeTracingListView"] = new ExplorativeTracingListView(@options)
    @tabPane.show(view, preventDestroy : true)


  showLoggedTime : ->

    unless view = @viewCache["loggedTimeView"]
      view = @viewCache["loggedTimeView"] = new LoggedTimeView(@options)
    @tabPane.show(view, preventDestroy : true)

