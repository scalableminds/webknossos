### define
jquery : $
underscore : _
backbone : Backbone
oxalis/constants : constants
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
    "annotations/:type/:id"         : "tracingView"
    "datasets/:id/view"             : "tracingViewPublic"
    "dashboard"                     : "dashboard"
    "users/:id/details"             : "dashboard"
    "taskTypes/:id/edit"            : "editTaskType"
    "taskTypes"                     : "taskTypes"
    "spotlight"                     : "spotlight"
    "tasks/overview"                : "taskOverview"
    "admin/taskTypes"               : "hideLoading"


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


    require ["oxalis/view/tracing_layout_view"], (TracingLayoutView) =>

      view = new TracingLayoutView(
        tracingType: type
        tracingId : id
        controlMode : constants.CONTROL_MODE_TRACE
      )
      view.forcePageReload = true
      @changeView(view)


  tracingViewPublic : (id) ->

    require ["oxalis/view/tracing_layout_view"], (TracingLayoutView) =>
      view = new TracingLayoutView(
        tracingType: "View"
        tracingId : id
        controlMode : constants.CONTROL_MODE_VIEW
      )
      view.forcePageReload = true
      @changeView(view)


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

    require ["dashboard/views/dashboard_view", "dashboard/models/user_model"], (DashboardView, UserModel) =>

      isAdminView = userID != null

      model = new UserModel(id : userID)
      view = new DashboardView({ model, isAdminView, userID})

      @listenTo(model, "sync", ->
        @changeView(view)
        @hideLoading()
      )

      model.fetch()

  spotlight : ->

    require(["views/spotlight_view", "dashboard/models/dataset/dataset_collection"], (SpotlightView, DatasetCollection) =>

      collection = new DatasetCollection()
      view = new SpotlightView(model: collection)

      @changeView(view)
      @listenTo(collection, "sync", @hideLoading)
    )


  taskOverview : ->

    require(["admin/views/task/task_overview_view", "admin/models/task/task_overview_model"], (TaskOverviewView, TaskOverviewModel) =>

      model = new TaskOverviewModel()
      view = new TaskOverviewView({model, userID})

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
        setTimeout((=> @hideLoading()), 200)

      @changeView(view)


  changeView : (views...) ->

    if @activeViews == views
      return

    @$loadingSpinner.removeClass("hidden")

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

    return

  loadURL : (url) ->

    window.location = url
