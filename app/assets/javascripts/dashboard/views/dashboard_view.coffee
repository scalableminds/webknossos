### define
underscore : _
backbone.marionette : marionette
dashboard/views/dashboard_task_list_view : DashboardTaskListView
dashboard/views/explorative_tracing_list_view : ExplorativeTracingListView
dashboard/views/tracked_time_view : TrackedTimeView
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
          <a href="#" id="tab-tracked-time" data-toggle="tab">Tracked Time</a>
        </li>
      </ul>
      <div class="tab-content">
        <div class="tab-pane active"></div>
      </div>
    </div>
  """)

  events :
    "click #tab-datasets" : "showDatasets"
    "click #tab-tasks" : "showTasks"
    "click #tab-explorative" : "showExplorative"
    "click #tab-tracked-time" : "showTrackedTime"


  regions :
    "tabPane" : ".tab-pane"


  initialize : ->

    @listenTo(@model, "sync", ->
      @render()
      @afterSync()
    )
    @model.fetch()


  afterSync : ->

    if @activeTab
      @refreshActiveTab()
      @showTab(@activeTab)
    else
      if @model.attributes.isAdminView
        @showTasks()
      else
        @showDatasets()



  showDatasets : ->

    @activeTab = {
      tabHeaderId : "tab-datasets"
      tabView : new DatasetSwitchView(model : @model.get("user"))
    }
    @showTab(@activeTab)


  showTasks : ->

    @activeTab = {
      tabHeaderId : "tab-tasks"
      tabView : new DashboardTaskListView(model : @model)
    }
    @showTab(@activeTab)


  showExplorative : ->

    @activeTab = {
      tabHeaderId : "tab-explorative"
      tabView : new ExplorativeTracingListView(model : @model)
    }
    @showTab(@activeTab)


  showTrackedTime : ->

    @activeTab = {
      tabHeaderId : "tab-tracked-time"
      tabView : new TrackedTimeView(model : @model.get("loggedTime"))
    }
    @showTab(@activeTab)


  refreshActiveTab : ->

    # ensure that tabView is not destroyed
    if @activeTab and @activeTab.tabView.isDestroyed
      view = @activeTab.tabView
      @activeTab.tabView = new view.constructor(view)


  showTab : ({tabHeaderId, tabView}) ->

    @$(".tabbable ul li").removeClass("active")
    @$("##{tabHeaderId}").parent().addClass("active")
    @tabPane.show(tabView)

