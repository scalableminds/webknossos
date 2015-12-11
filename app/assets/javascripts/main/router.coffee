$         = require("jquery")
_         = require("lodash")
Backbone  = require("backbone")
constants = require("oxalis/constants")

# #####
# This Router contains all the routes for views that have been
# refactored to Backbone.View yet. All other routes, that require HTML to be
# delivered by the Server are handled by the NonBackboneRouter.
# #####
class Router extends Backbone.Router

  routes :
    "users"                             : "users"
    "teams"                             : "teams"
    "statistics"                        : "statistics"
    "tasks"                             : "tasks"
    "projects"                          : "projects"
    "annotations/:type/:id(/readOnly)"  : "tracingView"
    "datasets/:id/view"                 : "tracingViewPublic"
    "dashboard"                         : "dashboard"
    "datasets"                          : "dashboard"
    "users/:id/details"                 : "dashboard"
    "taskTypes/:id/edit"                : "editTaskType"
    "taskTypes"                         : "taskTypes"
    "spotlight"                         : "spotlight"
    "tasks/overview"                    : "taskOverview"
    "admin/taskTypes"                   : "hideLoading"
    "workload"                          : "workload"


  initialize : ->

    # handle all links and manage page changes (rather the reloading the whole site)
    $(document).on "click", "a", (evt) =>

      url = $(evt.currentTarget).attr("href") or ""
      urlWithoutSlash = url.slice(1)

      if newWindow = $(evt.target).data("newwindow")
        [ width, height ] = newWindow.split("x")
        window.open(url, "_blank", "width=#{width},height=#{height},location=no,menubar=no")
        evt.preventDefault()
        return

      # disable links beginning with #
      if url.indexOf("#") == 0
        return

      # allow opening links in new tabs
      if evt.metaKey or evt.ctrlKey
        return

      # allow target=_blank etc
      if evt.currentTarget.target != ""
        return

      for route of @routes
        regex = @_routeToRegExp(route)
        if regex.test(urlWithoutSlash)
          evt.preventDefault()
          @navigate(url, trigger : true)

          return

      return

    @$loadingSpinner = $("#loader")
    @$mainContainer = $("#main-container")


  hideLoading : ->

    @$loadingSpinner.addClass("hidden")


  tracingView : (type, id) ->

    # Webpack messes up `this` binding, so we'll do it explicitly
    self = this
    require(["oxalis/view/tracing_layout_view"], (TracingLayoutView) ->

      view = new TracingLayoutView(
        tracingType: type
        tracingId : id
        controlMode : constants.CONTROL_MODE_TRACE
      )
      view.forcePageReload = true
      self.changeView(view)
    )


  tracingViewPublic : (id) ->

    self = this
    require(["oxalis/view/tracing_layout_view"], (TracingLayoutView) ->
      view = new TracingLayoutView(
        tracingType: "View"
        tracingId : id
        controlMode : constants.CONTROL_MODE_VIEW
      )
      view.forcePageReload = true
      self.changeView(view)
    )


  projects : ->

    @showWithPagination("ProjectListView", "ProjectCollection", "Create New Project")


  statistics : ->

    @showAdminView("StatisticView")


  users : ->

    @showWithPagination("UserListView", "UserCollection")


  teams : ->

    @showWithPagination("TeamListView", "PaginatedTeamCollection", "Add New Team")


  tasks : ->

    @showWithPagination("TaskListView", "TaskCollection", "Create New Task")


  workload : ->

    @showWithPagination("WorkloadListView", "WorkloadCollection")


  workload : ->

    @showWithPagination("WorkloadListView", "WorkloadCollection")


  taskTypes : ->

    self = this
    require(["admin/views/tasktype/task_type_view", "admin/models/tasktype/task_type_collection"], (TaskTypeView, TaskTypeCollection) ->

      collection = new TaskTypeCollection()
      view = new TaskTypeView(collection: collection)
      self.changeView(view)
      self.hideLoading()
    )


  editTaskType : (taskTypeID) ->

    self = this
    require(["admin/views/tasktype/task_type_form_view", "admin/models/tasktype/task_type_model"], (TaskTypeFormView, TaskTypeModel) =>

      model = new TaskTypeModel({id : taskTypeID})
      view = new TaskTypeFormView(model : model, isEditForm : true)
      self.changeView(view)
      self.hideLoading()
    )


  dashboard : (userID) =>

    self = this
    require(["dashboard/views/dashboard_view", "dashboard/models/dashboard_model"], (DashboardView, DashboardModel) ->

      isAdminView = userID != null

      model = new DashboardModel({ userID, isAdminView : isAdminView })
      view = new DashboardView(model : model, isAdminView : isAdminView)

      self.changeView(view)
      self.listenTo(model, "sync", self.hideLoading)
    )

  spotlight : ->

    self = this
    require(["views/spotlight_view", "admin/models/dataset/dataset_collection"], (SpotlightView, DatasetCollection) ->

      collection = new DatasetCollection()
      view = new SpotlightView(model: collection)

      self.changeView(view)
      self.listenTo(collection, "sync", self.hideLoading)
    )


  taskOverview : ->

    self = this
    require(["admin/views/task/task_overview_view", "admin/models/task/task_overview_model"], (TaskOverviewView, TaskOverviewModel) ->

      model = new TaskOverviewModel()
      view = new TaskOverviewView({model})

      self.changeView(view)
      self.listenTo(model, "sync", self.hideLoading)
    )


  showWithPagination : (view, collection, addButtonText=null) ->

    self = this
    require(["admin/admin"], (admin) ->

      collection = new admin[collection]()
      view = new admin[view](collection: collection)
      paginationView = new admin.PaginationView({collection, addButtonText})

      self.changeView(paginationView, view)
      self.listenTo(collection, "sync", => self.hideLoading())
    )


  showAdminView : (view, collection) ->

    self = this
    require(["admin/admin"], (admin) ->

      if collection
        collection = new admin[collection]()
        view = new admin[view](collection : collection)
        self.listenTo(collection, "sync", => self.hideLoading())
      else
        view = new admin[view]()
        setTimeout((=> self.hideLoading()), 200)

      self.changeView(view)
    )


  setReloadFlag : ->

    # DO NOT MERGE FORCE RELOAD INTO DEV #895
    @forcePageReload = true


  changeView : (views...) ->

    if @activeViews == views
      return

    @$loadingSpinner.removeClass("hidden")

    # DO NOT MERGE FORCE RELOAD INTO DEV #895
    if @forcePageReload
      location.reload()


    # Remove current views
    if @activeViews
      for view in @activeViews
        # prefer Marionette's.destroy() function to Backbone's remove()
        if view.destroy
          view.destroy()
        else
          view.remove()

      if view.forcePageReload
        @loadURL(location.href)

    else
      # we are probably coming from a URL that isn't a Backbone.View yet (or page reload)
      @$mainContainer.empty()

    # Add new views
    @activeViews = views
    for view in views
      @$mainContainer.append(view.render().el)

    # Google Analytics
    if ga?
      ga("send", "pageview", location.pathname)

    return

  loadURL : (url) ->

    window.location = url

module.exports = Router
