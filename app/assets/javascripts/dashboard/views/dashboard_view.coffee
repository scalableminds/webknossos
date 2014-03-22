### define
underscore : _
backbone.marionette : marionette
app : app
dashboard/views/dashboard_task_list_view : DashboardTaskListView
dashboard/views/explorative_tracing_list_view : ExplorativeTracingListView
dashboard/views/tracked_time_view : TrackedTimeView
dashboard/models/dashboard_model : DashboardModel
###

class DashboardView extends Backbone.Marionette.Layout

  className : "container wide"
  id : "dashboard"
  template : _.template("""
    <div class="tabbable" id="tabbable-dashboard">
      <ul class="nav nav-tabs">
        <li class="active">
          <a href="#tab-tasks"  id="tab-tasks" data-toggle="tab">Tasks</a>
        </li>
        <li>
          <a href="#tab-explorative"  id="tab-explorative" data-toggle="tab">Explorative Tracings</a>
        </li>
        <li>
          <a href="#tab-tracked-time" id="tab-tracked-time" data-toggle="tab">Tracked Time</a>
        </li>
      </ul>
      <div class="tab-content">
        <div class="tab-pane active"> My Tab Pane </div>
      </div>
    </div>
  """)

  ui :
    "tabTasks" : "#tab-tasks"
    "tabExplorative" : "#tab-explorative"
    "tabTrackedTime" : "#tab-tracked-time"
    "tabPane" : ".tab-pane"


  events :
    "click #tab-tasks" : "showTasks"
    "click #tab-explorative" : "showExplorative"
    "click #tab-tracked-time" : "showTrackedTime"

  regions :
    "tabPane" : ".tab-pane"


  initialize : ->

    @bindUIElements()

    window.test = @
    @model = new DashboardModel()
    @listenTo(@model, "sync", @showTasks)

    @model.fetch()


  showTasks : ->

    console.log("showing tasks")
    view = new DashboardTaskListView( model : @model, asAdmin : false )
    @tabPane.show(view)


  showExplorative : ->

    console.log("showing Explorative")
    view = new ExplorativeTracingListView( model : @model, asAdmin : false )
    @tabPane.show(view)


  showTrackedTime : ->

    console.log("showing tracked time")
    view = new TrackedTimeView( model : @model )
    @tabPane.show(view)

