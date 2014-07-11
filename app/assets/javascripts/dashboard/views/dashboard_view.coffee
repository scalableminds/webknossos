### define
underscore : _
backbone.marionette : marionette
dashboard/views/dashboard_task_list_view : DashboardTaskListView
dashboard/views/explorative_tracing_list_view : ExplorativeTracingListView
dashboard/views/tracked_time_view : TrackedTimeView
dashboard/models/logged_time_model : LoggedTimeModel
###

class DashboardView extends Backbone.Marionette.LayoutView

  className : "container wide"
  id : "dashboard"
  template : _.template("""
    <% if (isAdminView) { %>
      <h3>User: <%= user.firstName %> <%= user.lastName %></h3>
    <% } %>
    <div class="tabbable" id="tabbable-dashboard">
      <ul class="nav nav-tabs">
        <li class="active">
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


  initialize : (options) ->

    @model.fetch().done( =>
      @showTasks()
    )

  showTasks : ->

    view = new DashboardTaskListView(model : @model)
    @tabPane.show(view)


  showExplorative : ->

    view = new ExplorativeTracingListView(model : @model)
    @tabPane.show(view)


  showTrackedTime : ->

    trackedTimeView = new TrackedTimeView(model : @model.get("loggedTime"))
    @tabPane.show(trackedTimeView)

