### define
underscore : _
backbone.marionette : marionette
dashboard/views/dashboard_task_list_view : DashboardTaskListView
dashboard/views/explorative_tracing_list_view : ExplorativeTracingListView
dashboard/views/tracked_time_view : TrackedTimeView
admin/views/dataset/dataset_switch_view : DatasetSwitchView
###

class DashboardView extends Backbone.Marionette.Layout

  className : "container wide"
  id : "dashboard"
  template : _.template("""
    <% if (isAdminView) { %>
      <h3>User: <%= user.firstName %> <%= user.lastName %></h3>
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
          <a href="#" id="tab-explorative" data-toggle="tab">Explorative Tracings</a>
        </li>
        <li>
          <a href="#" id="tab-tracked-time" data-toggle="tab">Tracked Time</a>
        </li>
      </ul>
      <div class="tab-content">
        <div class="tab-pane active"></div>
      </div>
    </div>
  """)

  ui :
    "tabDatasets" : "#tab-datasets"
    "tabTasks" : "#tab-tasks"
    "tabExplorative" : "#tab-explorative"
    "tabTrackedTime" : "#tab-tracked-time"
    "tabPane" : ".tab-pane"


  events :
    "click #tab-datasets" : "showDatasets"
    "click #tab-tasks" : "showTasks"
    "click #tab-explorative" : "showExplorative"
    "click #tab-tracked-time" : "showTrackedTime"


  regions :
    "tabPane" : ".tab-pane"


  initialize : (options) ->

    @model.fetch().done( =>
      @showDatasets()
    )


  showDatasets : ->

    spotlightDatasetListView = new DatasetSwitchView(model : @model.get("dataSets"))
    @tabPane.show(spotlightDatasetListView)


  showTasks : ->

    dashboardTaskListView = new DashboardTaskListView(model : @model)
    @tabPane.show(dashboardTaskListView)


  showExplorative : ->

    explorativeTracingListView = new ExplorativeTracingListView(model : @model)
    @tabPane.show(explorativeTracingListView)


  showTrackedTime : ->

    trackedTimeView = new TrackedTimeView(model : @model.get("loggedTime"))
    @tabPane.show(trackedTimeView)
