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
    "tasks/create"                  : "taskCreate"
    "tasks/:id/edit"                : "taskEdit"
    "projects"                      : "projects"
    "dashboard"                     : "dashboard"
    "users/:id/details"             : "dashboard"
    "taskTypes/:id/edit"            : "editTaskType"
    "taskTypes"                     : "taskTypes"
    "spotlight"                     : "spotlight"
    "tasks/overview"                : "taskOverview"

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

    @showWithPagination("ProjectListView", "ProjectCollection")


  statistics : ->

    @showAdminView("StatisticView")


  users : ->

    @showWithPagination("UserListView", "UserCollection")


  teams : ->

    @showWithPagination("TeamListView", "TeamCollection")


  tasks : ->

    @showWithPagination("TaskListView", "TaskCollection")


  ###*
   * Load layout view that shows task-creation subviews
   ###
  taskCreate : ->

    require ["admin/views/task/task_create_view", "admin/models/task/task_model"], (TaskCreateView, TaskModel) =>
      # create an empty task model which will be populated in the create view
      model = new TaskModel()

      # create the task creation view
      view = new TaskCreateView(model : model)

      # show view
      @changeView(view)

      # auto-hide the loading spinner
      @hideLoading()


  ###*
   * Load item view which displays an editable task.
   ###
  taskEdit : (taskID) ->

    require ["admin/views/task/task_edit_view", "admin/models/task/task_model"], (TaskEditView, TaskModel) =>
      # create and populate the task model
      model = new TaskModel(id : taskID)

      # create the task edit view
      view = new TaskEditView(model : model)

      # show view
      @changeView(view)

      # auto-hide the loading spinner
      @hideLoading()


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
