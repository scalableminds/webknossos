### define
jquery : $
underscore : _
libs/toast : Toast
main/routing_utils : RoutingUtils
oxalis/constants : constants
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
    "datasets"                      : "datasets"
    "tasks"                         : "tasks"


  initialize : ->


    # handle all links and manage page changes (rather the reloading the whole site)
    $("a").on "click", (evt) =>

      url = $(evt.target).attr("href")
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

    require [
      "admin/views/project/project_list_view",
      "admin/views/pagination_view",
      "admin/models/project/project_collection"], (ProjectListView, PaginationView, ProjectCollection) =>

      projectCollection = new ProjectCollection()
      paginationView = new PaginationView({collection: projectCollection})
      projectView = new ProjectListView({collection : projectCollection})

      @changeView(paginationView, projectView)
      return @hideLoading()


  datasets : ->

    require [
      "admin/views/dataset/dataset_list_view",
      "admin/views/pagination_view",
      "admin/models/dataset/dataset_collection"], (DatasetListView, PaginationView, DatasetCollection) =>

      datasetCollection = new DatasetCollection()
      paginationView = new PaginationView(collection: datasetCollection)
      datasetView = new DatasetListView(collection : datasetCollection)

      @changeView(paginationView, datasetView)
      @listenTo(datasetCollection, "sync", => @hideLoading())


  users : ->

    require [
      "admin/views/user/user_list_view",
      "admin/views/pagination_view"
      "admin/models/user/user_collection"], (UserListView, PaginationView, UserCollection) =>

      userCollection = new UserCollection()
      paginationView = new PaginationView(collection : userCollection)
      userListView = new UserListView(collection : userCollection)

      @changeView(paginationView, userListView)
      @listenTo(userCollection, "sync", => @hideLoading())


  teams : ->

    require [
      "admin/views/team/team_list_view"
      "admin/views/pagination_view"
      "admin/models/team/team_collection"
    ], (TeamListView, PaginationView, TeamCollection) =>

      teamCollection = new TeamCollection()
      paginationView = new PaginationView(collection : teamCollection)
      teamListView = new TeamListView(collection : teamCollection)

      @changeView(paginationView, teamListView)
      @listenTo(teamCollection, "sync", => @hideLoading())


  tasks : ->

    require [
      "admin/views/task/task_list_view",
      "admin/views/pagination_view"
      "admin/models/task/task_collection"], (TaskListView, PaginationView, TaskCollection) =>

      taskCollection = new TaskCollection()
      paginationView = new PaginationView(collection: taskCollection)
      taskListView = new TaskListView(collection: taskCollection)

      @changeView(paginationView, taskListView)
<<<<<<< HEAD
      return @hideLoading()


  taskAlgorithm : ->

    require ["admin/views/task/task_algorithm_view"], (TaskAlgorithmView) =>

      new TaskAlgorithmView(
        el : $("#main-container").find("#task-selection-algoritm")[0]
      )

      return @hideLoading()


  changeView : (views...) ->
=======
      @listenTo(taskCollection, "sync", => @hideLoading())



  changeView : (views...) ->

    if @activeViews == views
      return

    @$loadingSpinner.show()

    # Remove current views
    if @activeViews
      for view in @activeViews
        view.remove()
    else
      # we are probably coming from a URL that isn't a Backbone.View yet (or page reload)
      @$mainContainer.empty()
>>>>>>> #235 seperated router

    # Add new views
    @activeViews = views
    for view in views
      @$mainContainer.append(view.render().el)

    return
