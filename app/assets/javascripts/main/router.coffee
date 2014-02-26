### define
jquery : $
underscore : _
libs/toast : Toast
main/routing_utils : RoutingUtils
oxalis/constants : constants
backbone : Backbone
./paginator : Paginator
###

class Router extends Backbone.Router

  routes :
    "dashboard"                     : "dashboard"
    "users"                         : "users"
    "teams"                         : "teams"
    "datasets"                      : "datasets"
    "admin/taskTypes"               : "hideLoading"
    "admin/projects"                : "projects"
    "admin/tasks/overview"          : "taskOverview"
    "annotations/Task/:id"          : "tracingTrace"
    "annotations/Explorational/:id" : "tracingTrace"
    "annotations/View/:id"          : "tracingTrace"
    "datasets/:id/view"             : "tracingView"
    "users/:id/details"             : "userDetails"
    "*url"                          : "hideLoading"

    #"admin/tasks/algorithm"      : "taskAlgorithm"



  hideLoading : ->

    $("#loader").css("display" : "none")


  dashboard : ->

    require ["main/dashboardLoader"], (DashboardLoader) ->

      DashboardLoader.displayBasicDashboard()
      DashboardLoader.displayUserDashboard()
      return


  userDetails : ->

    require ["main/dashboardLoader"], (DashboardLoader) ->
      DashboardLoader.displayBasicDashboard()
      return


  tracingTrace : ->

    require [
      "oxalis/controller"
    ], (Controller) ->

      leftTabBar = $("#main")
      dataUrl = leftTabBar.data("url")

      populateTemplate = (data) ->
        templateSource = _.unescape(leftTabBar.html())
        templateOutput = _.template(templateSource)(data)
        leftTabBar.html(templateOutput)

      $.ajax(
        url: dataUrl
        type: 'GET'
        success: (task) ->

          if task.noData
            populateTemplate({task : null})
          else
            populateTemplate({task : task})

        error: (xhr, status, error) ->

          console.error("Something went wrong when receiving task data", xhr, status, error)

        complete: (task) ->

          oxalis = window.oxalis = new Controller(constants.CONTROL_MODE_TRACE)
      )

      return


  tracingView : ->

    require [
      "oxalis/controller"
      "slider"
    ], (Controller) ->

      oxalis = window.oxalis = new Controller(constants.CONTROL_MODE_VIEW)

      return


  datasets : ->

    require [
      "admin/views/dataset/dataset_list_view",
      "admin/views/pagination_view",
      "admin/models/dataset/dataset_collection"], (DatasetListView, PaginationView, DatasetCollection) =>

      datasetCollection = new DatasetCollection()
      paginationView = new PaginationView({collection: datasetCollection})
      datasetView = new DatasetListView({collection : datasetCollection})

      @changeView(paginationView, datasetView)
      return @hideLoading()


  taskOverview : ->

    require ["admin/views/task/task_overview_view"], (TaskOverviewView) =>

      new TaskOverviewView(
        el : $("#main-container").find("#task-overview")[0]
      )
      return @hideLoading()


  users : ->

    require [
      "admin/views/user/user_list_view",
      "admin/views/pagination_view"
      "admin/models/user/user_collection"], (UserListView, PaginationView, UserCollection) =>

      userCollection = new UserCollection()
      paginationView = new PaginationView({collection: userCollection})
      userListView = new UserListView({collection: userCollection})

      @changeView(paginationView, userListView)
      return @hideLoading()


  teams : ->

    require ["admin/views/team/team_list_view"], (TeamListView) =>

      @changeView(new TeamListView())
      return @hideLoading()


  taskAlgorithm : ->

    require ["admin/views/task/task_algorithm_view"], (TaskAlgorithmView) =>

      new TaskAlgorithmView(
        el : $("#main-container").find("#task-selection-algoritm")[0]
      )

      return @hideLoading()


  projects : ->

    preparePaginationData = (projects, users) ->

      for aProject, index in projects

        id = aProject._owner.$oid
        owner = _.find(users, (u) -> u.id == id)

        if owner
          ownerName = owner.firstName + " " + owner.lastName
        else
          ownerName = "<deleted>"

        projects[index].owner = ownerName

      return {"data" : projects }

    $owner = $("#owner")
    $pageSelection = $(".page-selection")

    ajaxOptions =
      url : $pageSelection.data("url")
      dataType : "json"
      type : "get"

    $.ajax(ajaxOptions).done((response) ->

      paginationData = preparePaginationData(response.projects, response.users)

      new Paginator( $pageSelection, paginationData)

      for aUser in response.users
        $owner.append("<option value='#{aUser.id}' selected=''>#{aUser.firstName} #{aUser.lastName}</option>")
    )


  changeView : (views...) ->

    $mainContainer = $("#main-container").empty()
    for view in views
      $mainContainer.append(view.render().el)




