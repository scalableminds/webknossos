$          = require("jquery")
_          = require("lodash")
Backbone   = require("backbone")
constants  = require("oxalis/constants")
BaseRouter = require("libs/base_router")

# #####
# This Router contains all the routes for views that have been
# refactored to Backbone.View yet. All other routes, that require HTML to be
# delivered by the Server are handled by the NonBackboneRouter.
# #####
class Router extends BaseRouter

  routes :
    "users"                             : "users"
    "teams"                             : "teams"
    "statistics"                        : "statistics"
    "tasks"                             : "tasks"
    "tasks/create"                      : "taskCreate"
    "tasks/:id/edit"                    : "taskEdit"
    "projects"                          : "projects"
    "annotations/:type/:id(/readOnly)"  : "tracingView"
    "datasets/:id/view"                 : "tracingViewPublic"
    "dashboard"                         : "dashboard"
    "datasets"                          : "dashboard"
    "datasets/upload"                   : "datasetUpload"
    "users/:id/details"                 : "dashboard"
    "taskTypes/:id/edit"                : "editTaskType"
    "taskTypes"                         : "taskTypes"
    "spotlight"                         : "spotlight"
    "tasks/overview"                    : "taskOverview"
    "admin/taskTypes"                   : "hideLoadingSpinner"
    "workload"                          : "workload"


  constructor : ->
    super
    @$loadingSpinner = $("#loader")
    @$mainContainer = $("#main-container")


  hideLoadingSpinner : ->

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


  datasetUpload : ->

    @showAdminView("DatasetUploadView")


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



  ###*
   * Load layout view that shows task-creation subviews
   ###
  taskCreate : ->

    self = this
    require(["admin/views/task/task_create_view", "admin/models/task/task_model"], (TaskCreateView, TaskModel) ->

      model = new TaskModel()
      view = new TaskCreateView(model : model)

      self.changeView(view)
      self.hideLoadingSpinner()
    )

  ###*
   * Load item view which displays an editable task.
   ###
  taskEdit : (taskID) ->

    self = this
    require(["admin/views/task/task_create_subviews/task_create_from_view", "admin/models/task/task_model"], (TaskCreateFromView, TaskModel) ->

      model = new TaskModel(id : taskID)
      view = new TaskCreateFromView(model : model, type : "from_form")

      self.changeView(view)
      self.hideLoadingSpinner()
    )

  taskTypes : ->

    self = this
    require(["admin/views/tasktype/task_type_view", "admin/models/tasktype/task_type_collection"], (TaskTypeView, TaskTypeCollection) ->

      collection = new TaskTypeCollection()
      view = new TaskTypeView(collection: collection)
      self.changeView(view)
      self.hideLoadingSpinner()
    )


  editTaskType : (taskTypeID) ->

    self = this
    require(["admin/views/tasktype/task_type_form_view", "admin/models/tasktype/task_type_model"], (TaskTypeFormView, TaskTypeModel) =>

      model = new TaskTypeModel({id : taskTypeID})
      view = new TaskTypeFormView(model : model, isEditMode : true)
      self.changeView(view)
      self.hideLoadingSpinner()
    )


  dashboard : (userID) =>

    self = this
    require(["dashboard/views/dashboard_view", "dashboard/models/user_model"], (DashboardView, UserModel) ->

      isAdminView = userID != null

      model = new UserModel(id : userID)
      view = new DashboardView({ model, isAdminView, userID})

      self.listenTo(model, "sync", ->
        self.changeView(view)
        self.hideLoadingSpinner()
      )

      model.fetch()
    )


  spotlight : ->

    self = this
    require(["views/spotlight_view", "admin/models/dataset/paginated_dataset_collection"], (SpotlightView, PaginatedDatasetCollection) ->

      collection = new PaginatedDatasetCollection()
      view = new SpotlightView(collection: collection)

      self.changeView(view)
      self.listenTo(collection, "sync", self.hideLoadingSpinner)
    )


  taskOverview : ->

    self = this
    require(["admin/views/task/task_overview_view", "admin/models/task/task_overview_collection"], (TaskOverviewView, TaskOverviewCollection) ->

      collection = new TaskOverviewCollection()
      view = new TaskOverviewView({collection})

      self.changeView(view)
      self.listenTo(collection, "sync", self.hideLoadingSpinner)
    )


  showWithPagination : (view, collection, addButtonText = null) ->

    self = this
    require(["admin/admin"], (admin) ->

      collection = new admin[collection]()
      view = new admin[view](collection: collection)
      paginationView = new admin.PaginationView({ collection, addButtonText })

      self.changeView(paginationView, view)
      self.listenTo(collection, "sync", => self.hideLoadingSpinner())
    )


  showAdminView : (view, collection) ->

    self = this
    require(["admin/admin"], (admin) ->

      if collection
        collection = new admin[collection]()
        view = new admin[view](collection : collection)
        self.listenTo(collection, "sync", => self.hideLoadingSpinner())
      else
        view = new admin[view]()
        setTimeout((=> self.hideLoadingSpinner()), 200)

      self.changeView(view)
    )

  changeView : (views...) ->

    if _.isEqual(@activeViews, views)
      return

    @$loadingSpinner.removeClass("hidden")

    # Add new views
    @activeViews = views
    for view in views
      @$mainContainer.append(view.render().el)

    # Google Analytics
    if ga?
      ga("send", "pageview", location.pathname)

    return


module.exports = Router
