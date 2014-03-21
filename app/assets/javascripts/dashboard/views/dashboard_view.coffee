### define
underscore : _
backbone.marionette : marionette
app : app
dashboard/views/dashboard_task_list_view : DashboardTaskListView
dashboard/models/dashboard_model : DashboardModel
###

class DashboardView extends Backbone.Marionette.Layout

  className : "container"
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


    view = new DashboardTaskListView( model : @model )
    @tabPane.show(view)
    console.log("showing tasks")


  showTrackedTime : ->

    console.log("showing tracked time")
    @ui.tabPane.html("")


  showExplorative : ->

    console.log("showing Explorative")
    @ui.tabPane.html("")



