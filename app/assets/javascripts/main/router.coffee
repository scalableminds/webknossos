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
    "tasks"                         : "tasks"
    "admin/tasks/overview"          : "taskOverview"
    "admin/taskTypes"               : "hideLoading"
    "admin/projects"                : "projects"
    "admin/datasets"                : "datasets"
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

    $modal = $(".modal")
    $modal.find(".btn-primary").on "click", -> submitTeams()

    # Attach model to main body to avoid z-Index
    $modal = $modal.detach()
    $("body").append($modal)

    teamsCache = null
    assignedTeams = []

    $(".team-label").on "click", ->
      # Find parent and read all labels for one dataset
      $parent = $(this).closest("tr")
      dataset = $parent.find("td").first().text().trim()
      $modal.data("dataset", dataset)

      $labels = $parent.find(".team-label").find(".label")
      assignedTeams = _.map($labels, (label) -> return $(label).text())

      if teamsCache
        showModal()
      else
        $.ajax(
          url: "/api/teams"
          dataType: "json"
        ).done (responseJSON) =>
          teamsCache = responseJSON
          showModal()

    showModal = ->

      $teamList = $modal.find("ul").empty()
      $checkBoxTags = _.map(teamsCache, (team) ->

        checked = if _.contains(assignedTeams, team.name) then "checked" else ""
        $("""
          <li>
            <label class="checkbox"><input type="checkbox" value="#{team.name}" #{checked}> #{team.name}</label>
          </li>
        """)
      )
      $teamList.append($checkBoxTags)
      $modal.modal("show")


    submitTeams = ->

        $checkboxes = $modal.find("input:checked")
        dataset = $modal.data("dataset")
        assignedTeams = _.map($checkboxes, (checkbox) -> return $(checkbox).parent().text().trim())

        console.log dataset, assignedTeams
        $modal.modal("hide")
        $.ajax(
          url: "/api/datasets/#{dataset}/teams"
          type: "POST"
          contentType: "application/json; charset=utf-8"
          data: JSON.stringify(assignedTeams)
        ).done ->
          window.location.reload()

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
      paginationView = new PaginationView({collection : userCollection})
      userListView = new UserListView({collection : userCollection})

      @changeView(paginationView, userListView)
      return @hideLoading()


  teams : ->

    require [
      "admin/views/team/team_list_view"
      "admin/views/pagination_view"
      "admin/models/team/team_collection"
    ], (TeamListView, PaginationView, TeamCollection) =>

      teamCollection = new TeamCollection()
      paginationView = new PaginationView({collection : teamCollection})
      teamListView = new TeamListView({collection : teamCollection})

      @changeView(paginationView, teamListView)
      return @hideLoading()


  tasks : ->

    require [
      "admin/views/task/task_list_view",
      "admin/views/pagination_view"
      "admin/models/task/task_collection"], (TaskListView, PaginationView, TaskCollection) =>

      taskCollection = new TaskCollection()
      paginationView = new PaginationView({collection: taskCollection})
      taskListView = new TaskListView({collection: taskCollection})

      @changeView(paginationView, taskListView)
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

