### define
jquery : $
underscore : _
backbone : Backbone
###

# #####
# This Router contains all the routes for views that have been
# refactored to Backbone.View yet. All other routes, that require HTML to be
# delivered by the Server are handled by the NonBackboneRouter.
# #####
class Router extends Backbone.Router

  routes :
    "users"                         : "users"
    "teams"                         : "teams"
    "statistics"                    : "statistics"
    "tasks"                         : "tasks"
    "projects"                      : "projects"
    "dashboard"                     : "dashboard"
    "users/:id/details"             : "dashboard"
    "taskTypes/:id/edit"            : "editTaskType"
    "taskTypes"                     : "taskTypes"
    "spotlight"                     : "spotlight"
    "tasks/overview"                : "taskOverview"


  initialize : ->


    # handle all links and manage page changes (rather the reloading the whole site)
    $(document).on "click", "a", (evt) =>

      url = $(evt.currentTarget).attr("href") or ""
      urlWithoutSlash = url.slice(1)

      if @routes[urlWithoutSlash]
        evt.preventDefault()
        @navigate(url, { trigger: true })

      return

    @$loadingSpinner = $("#loader")
    @$mainContainer = $("#main-container")


  hideLoading : ->

    @$loadingSpinner.hide()


  projects : ->

    @showWithPagination("ProjectListView", "ProjectCollection")


  statistics : ->

    @showAdminView("StatisticView")


  users : ->

    @showWithPagination("UserListView", "UserCollection")


  teams : ->

    @showWithPagination("TeamListView", "TeamCollection")


  tasks : ->

    @showWithPagination("TaskListView", "TaskCollection")

  taskTypes : ->

    require ["admin/views/tasktype/task_type_view", "admin/models/tasktype/task_type_collection"], (TaskTypeView, TaskTypeCollection) =>

      collection = new TaskTypeCollection()
      view = new TaskTypeView(collection: collection)
      @changeView(view)

      @hideLoading()


  editTaskType : (taskTypeID) ->

    require ["admin/views/tasktype/task_type_form_view", "admin/models/tasktype/task_type_model"], (TaskTypeFormView, TaskTypeModel) =>

      model = new TaskTypeModel({id : taskTypeID})
      view = new TaskTypeFormView(model : model, isEditForm : true)
      @changeView(view)

      @hideLoading()


  dashboard : (userID) ->

    require ["dashboard/views/dashboard_view", "dashboard/models/dashboard_model"], (DashboardView, DashboardModel) =>

      isAdminView = userID != null

      model = new DashboardModel({ userID, isAdminView : false })
      view = new DashboardView(model : model, isAdminView : isAdminView)

      @changeView(view)
      @listenTo(model, "sync", @hideLoading)


  spotlight : ->

    require(["views/spotlight_view", "admin/models/dataset/dataset_collection"], (SpotlightView, DatasetCollection) =>

      collection = new DatasetCollection()
      view = new SpotlightView(model: collection)

      @changeView(view)
      @listenTo(collection, "sync", @hideLoading)
    )


  taskOverview : ->

    require(["admin/views/task/task_overview_view", "admin/models/task/task_overview_model"], (TaskOverviewView, TaskOverviewModel) =>

      model = new TaskOverviewModel()
      view = new TaskOverviewView({model})

      @changeView(view)
      @listenTo(model, "sync", @hideLoading)
    )


  showWithPagination : (view, collection) ->

    require ["admin/admin"], (admin) =>

      collection = new admin[collection]()
      view = new admin[view](collection: collection)
      paginationView = new admin.PaginationView(collection: collection)

      @changeView(paginationView, view)
      @listenTo(collection, "sync", => @hideLoading())


  showAdminView : (view, collection) ->

    require ["admin/admin"], (admin) =>

      if collection
        collection = new admin[collection]()
        view = new admin[view](collection : collection)
        @listenTo(collection, "sync", => @hideLoading())
      else
        view = new admin[view]()
        @hideLoading()

      @changeView(view)


  changeView : (views...) ->

    if @activeViews == views
      return

    @$loadingSpinner.show()

    # Remove current views
    if @activeViews
      for view in @activeViews
        # prefer Marionette's close() function to Backbone's remove()
        if view.close
          view.close()
        else
          view.remove()
    else
      # we are probably coming from a URL that isn't a Backbone.View yet (or page reload)
      @$mainContainer.empty()

    # Add new views
    @activeViews = views
    for view in views
      @$mainContainer.append(view.render().el)

    return

  loadURL : (url) ->

    window.location = url
