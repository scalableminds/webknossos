$                     = require("jquery")
_                     = require("lodash")
Backbone              = require("backbone")
constants             = require("oxalis/constants")
BaseRouter            = require("libs/base_router")
PaginationCollection  = require("admin/models/pagination_collection")

# #####
# This Router contains all the routes for views that have been
# refactored to Backbone.View yet. All other routes, that require HTML to be
# delivered by the Server are handled by the NonBackboneRouter.
# #####
class Router extends BaseRouter

  routes :
    "/users"                             : "users"
    "/teams"                             : "teams"
    "/statistics"                        : "statistics"
    "/tasks/create"                      : "taskCreate"
    "/tasks/:id/edit"                    : "taskEdit"
    "/projects"                          : "projects"
    "/projects/create"                   : "projectCreate"
    "/projects/:name/tasks"              : "projectTasks"
    "/projects/:id/edit"                 : "projectEdit"
    "/annotations/:type/:id(/readOnly)"  : "tracingView"
    "/datasets/:id/view"                 : "tracingViewPublic"
    "/dashboard"                         : "dashboard"
    "/datasets"                          : "dashboard"
    "/datasets/upload"                   : "datasetAdd"
    "/datasets/:id/edit"                 : "datasetEdit"
    "/users/:id/details"                 : "dashboard"
    "/taskTypes"                         : "taskTypes"
    "/taskTypes/create"                  : "taskTypesCreate"
    "/taskTypes/:id/edit"                : "taskTypesCreate"
    "/taskTypes/:id/tasks"               : "taskTypesTasks"
    "/spotlight"                         : "spotlight"
    "/tasks/overview"                    : "taskOverview"
    "/admin/taskTypes"                   : "hideLoadingSpinner"
    "/workload"                          : "workload"
    "/tasks"                             : "taskQuery"

  constructor : ->
    super
    @$loadingSpinner = $("#loader")
    @$mainContainer = $("#main-container")


  hideLoadingSpinner : ->

    @$loadingSpinner.addClass("hidden")


  tracingView : (type, id) ->

    require(["oxalis/view/tracing_layout_view"], (TracingLayoutView) =>

      view = new TracingLayoutView(
        tracingType: type
        tracingId : id
        controlMode : constants.CONTROL_MODE_TRACE
      )
      view.forcePageReload = true
      @changeView(view)
    )


  tracingViewPublic : (id) ->

    require(["oxalis/view/tracing_layout_view"], (TracingLayoutView) =>
      view = new TracingLayoutView(
        tracingType: "View"
        tracingId : id
        controlMode : constants.CONTROL_MODE_VIEW
      )
      view.forcePageReload = true
      @changeView(view)
    )


  projects : ->

    @showWithPagination("ProjectListView", "ProjectCollection", {addButtonText : "Create New Project"})


  projectCreate : ->

    require(["admin/views/project/project_create_view", "admin/models/project/project_model"], (ProjectCreateView, ProjectModel) =>

      model = new ProjectModel()
      view = new ProjectCreateView(model : model)

      @changeView(view)
      @hideLoadingSpinner()
    )


  projectEdit : (projectName) ->

    require(["admin/views/project/project_edit_view", "admin/models/project/project_model"], (ProjectEditView, ProjectModel) =>

      model = new ProjectModel(name : projectName)
      view = new ProjectEditView(model : model)

      @listenTo(model, "sync", ->
        @changeView(view)
        @hideLoadingSpinner()
      )
    )


  statistics : ->

    @showAdminView("StatisticView")


  datasetAdd : ->

    @showAdminView("DatasetAddView")


  datasetEdit : (datasetID) ->

    require(["admin/views/dataset/dataset_edit_view", "admin/models/dataset/dataset_model"], (DatasetEditView, DatasetModel) =>

      model = new DatasetModel(name : datasetID)
      view = new DatasetEditView(model : model)

      @listenTo(model, "sync", ->
        @changeView(view)
        @hideLoadingSpinner()
      )
    )


  users : ->

    @showWithPagination("UserListView", "UserCollection", {})


  teams : ->

    @showWithPagination("TeamListView", "TeamCollection", {addButtonText : "Add New Team"})


  taskQuery : ->

    require(["admin/views/task/task_query_view"], (TaskQueryView, TaskCollection) =>
      view = new TaskQueryView()
      @changeView(view)
    )


  projectTasks : (projectName) ->

     @showWithPagination("TaskListView", "TaskCollection", {projectName, addButtonText : "Create New Task"})


  taskTypesTasks : (taskTypeId) ->

     @showWithPagination("TaskListView", "TaskCollection", {taskTypeId, addButtonText : "Create New Task"})


  workload : ->

    @showWithPagination("WorkloadListView", "WorkloadCollection")


  taskTypes : ->

    @showWithPagination("TaskTypeListView", "TaskTypeCollection", {addButtonText : "Create New TaskType"})


  ###*
   * Load layout view that shows task-creation subviews
   ###
  taskCreate : ->

    require(["admin/views/task/task_create_view", "admin/models/task/task_model"], (TaskCreateView, TaskModel) =>

      model = new TaskModel()
      view = new TaskCreateView(model : model)

      @changeView(view)
      @hideLoadingSpinner()
    )

  ###*
   * Load item view which displays an editable task.
   ###
  taskEdit : (taskID) ->

    require(["admin/views/task/task_create_subviews/task_create_from_view", "admin/models/task/task_model"], (TaskCreateFromView, TaskModel) =>

      model = new TaskModel(id : taskID)
      view = new TaskCreateFromView(model : model, type : "from_form")

      @changeView(view)
      @hideLoadingSpinner()
    )


  taskTypesCreate : (taskTypeId) ->

    require(["admin/views/tasktype/task_type_create_view", "admin/models/tasktype/task_type_model"], (TaskTypeCreateView, TaskTypeModel) =>

      model = new TaskTypeModel(id : taskTypeId)
      view = new TaskTypeCreateView(model: model)
      @changeView(view)
      @hideLoadingSpinner()
    )


  dashboard : (userID) =>

    require(["dashboard/views/dashboard_view", "dashboard/models/user_model"], (DashboardView, UserModel) =>

      isAdminView = userID != null

      model = new UserModel(id : userID)
      view = new DashboardView({ model, isAdminView, userID})

      @listenTo(model, "sync", ->
        @changeView(view)
        @hideLoadingSpinner()
      )

      model.fetch()
    )


  spotlight : ->

    require(["dashboard/views/spotlight/spotlight_view", "admin/models/dataset/dataset_collection"], (SpotlightView, DatasetCollection) =>

      collection = new DatasetCollection()
      paginatedCollection = new PaginationCollection([], fullCollection : collection)
      view = new SpotlightView(collection: paginatedCollection)

      @changeView(view)
      @listenTo(collection, "sync", @hideLoadingSpinner)
    )


  taskOverview : ->

    require(["admin/views/task/task_overview_view", "admin/models/task/task_overview_collection"], (TaskOverviewView, TaskOverviewCollection) =>

      collection = new TaskOverviewCollection()
      view = new TaskOverviewView({collection})

      @changeView(view)
      @listenTo(collection, "sync", @hideLoadingSpinner)
    )


  showWithPagination : (view, collection, options = {}) ->

    _.defaults(options, {addButtonText : null})

    require(["admin/admin"], (admin) =>

      collection = new admin[collection](null, options)
      paginatedCollection = new PaginationCollection([], fullCollection : collection)
      view = new admin[view](collection : paginatedCollection)
      paginationView = new admin.PaginationView({collection : paginatedCollection, addButtonText : options.addButtonText})

      @changeView(paginationView, view)
      @listenTo(collection, "sync", => @hideLoadingSpinner())
    )


  showAdminView : (view, collection) ->

    require(["admin/admin"], (admin) =>

      if collection
        collection = new admin[collection]()
        view = new admin[view](collection : collection)
        @listenTo(collection, "sync", => @hideLoadingSpinner())
      else
        view = new admin[view]()
        setTimeout((=> @hideLoadingSpinner()), 200)

      @changeView(view)
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
