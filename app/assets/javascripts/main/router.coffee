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
    "datasets"                      : "dashboard"
    "datasets/upload"               : "datasetUpload"
    "users/:id/details"             : "dashboard"
    "taskTypes/:id/edit"            : "editTaskType"
    "taskTypes"                     : "taskTypes"
    "spotlight"                     : "spotlight"
    "tasks/overview"                : "taskOverview"
    "workload"                      : "workload"

  whitelist : [
    "help/keyboardshortcuts",
    "help/faq",
    "issues"
  ]

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

      # let whitelisted url through
      if _.contains(@whitelist, urlWithoutSlash)
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

    @$loadingSpinner.hide()


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

      model = new DashboardModel({ userID, isAdminView : isAdminView })
      view = new DashboardView(model : model, isAdminView : isAdminView)

      @changeView(view)
      @listenTo(model, "sync", @hideLoading)


  spotlight : ->

   require(["views/spotlight_view", "admin/models/dataset/paginated_dataset_collection"], (SpotlightView, PaginatedDatasetCollection) =>

     collection = new PaginatedDatasetCollection()
     view = new SpotlightView(collection: collection)

     @changeView(view)
     @listenTo(collection, "sync", self.hideLoading)
   )


  taskOverview : ->

    require(["admin/views/task/task_overview_view", "admin/models/task/task_overview_model"], (TaskOverviewView, TaskOverviewModel) =>

      model = new TaskOverviewModel()
      view = new TaskOverviewView({model})

      @changeView(view)
      @listenTo(model, "sync", @hideLoading)
    )


  showWithPagination : (view, collection, addButtonText=null) ->

    require ["admin/admin"], (admin) =>

      collection = new admin[collection]()
      view = new admin[view](collection: collection)
      paginationView = new admin.PaginationView({collection, addButtonText})

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


  setReloadFlag : ->

    # DO NOT MERGE FORCE RELOAD INTO DEV #895
    @forcePageReload = true


  changeView : (views...) ->

    if @activeViews == views
      return

    @$loadingSpinner.show()

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
