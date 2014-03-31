### define
jquery : $
underscore : _
backbone : Backbone
oxalis/constants : constants
###

class NonBackboneRouter extends Backbone.Router

  routes :
    "dashboard"                     : "dashboard"
    "admin/tasks/overview"          : "taskOverview"
    "admin/taskTypes"               : "hideLoading"
    "admin/projects"                : "projects"
    "annotations/:typ/:id"          : "tracingTrace"
    "datasets/:id/view"             : "tracingView"
    "users/:id/details"             : "userDetails"
    "*url"                          : "hideLoading"
    #"admin/tasks/algorithm"      : "taskAlgorithm"


  hideLoading : ->

    $("#loader").hide()


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
        success: (info) ->

          if info.task
            populateTemplate({task : null})
          else
            populateTemplate({task : info.task})

        error: (xhr, status, error) ->

          console.error("Something went wrong when receiving task data", xhr, status, error)

        complete: (info) ->

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


  taskOverview : ->

    require ["admin/views/task/task_overview_view"], (TaskOverviewView) =>

      new TaskOverviewView(
        el : $("#main-container").find("#task-overview")[0]
      )
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

      return { "data" : projects }

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

