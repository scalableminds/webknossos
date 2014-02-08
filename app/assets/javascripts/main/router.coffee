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

  initialize : ->


  routes :
    "dashboard" : "dashboard"
    "users" : "users"
    "admin/taskTypes" : "hideLoading"
    "admin/projects" : "projects"
    "admin/datasets" : "datasets"
    "admin/trainingsTasks/create" : "createTraingsTasks"
    "admin/tasks/overview" : "taskOverview"
    "annotations/Task/:id" : "tracingTrace"
    "datasets/:id/view" : "tracingView"
    "users/:id/details" : "userDetails"
    "*url"  : "hideLoading"

    #"admin/tasks/algorithm" : "taskAlgorithm"

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
      "./oxalis/controller"
      "./libs/core_ext"
      "three"
      "stats"
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
      "./oxalis/controller"
      "./libs/core_ext"
      "three"
      "three"
      "stats"
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

    require [ "worker!libs/viz.js", "libs/pan_zoom_svg" ], (VizWorker, PanZoomSVG) ->

      graphSource = $("#graphData").html().replace( /"[^"]+"/gm, (a) -> a.replace(" "," ") )
      userData = JSON.parse($("#userData").html())

      VizWorker.send(
        source : graphSource
        format : "svg"
        layoutEngine : "neato"
      ).then(
        (svgResult) ->

          #remove error messages
          startIndex = svgResult.indexOf("<?xml")
          svgResult = svgResult.slice(startIndex, svgResult.length - 1)

          $(".graph").html(svgResult)

          userData.map (user) ->
            $("#" + user.id + " > text").popover(
              title: user.name,
              html: true,
              trigger: "hover",
              content: user.tooltip
            )

          #reset some attributes before invoking panZoom plugin
          $svg = $(".graph.well").find("svg")
          $svg[0].removeAttribute("viewBox") #get rid of the troublemaker. messes up transformations
          $svg[0].setAttribute("width", "#{$(window).width() - 100}px")
          $svg[0].setAttribute("height", "#{$(window).height() - 50 - $svg.offset().top}px" )
          $svg.css("max-width", "100%")

          new PanZoomSVG($svg)

          @hideLoading()

        (error) ->
          $(".graph").html("<i class=\"fa fa-warning-sign\"></i> #{error.replace(/\n/g,"<br>")}")
      )

  users : ->

    require ["./admin/views/user/user_list_view"], (UserListView) =>

      view = new UserListView().render()
      $("#main-container").html(view.el)

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

  createTraingsTasks : ->

    url = $("#form-well").data("url")

    $.get(url).done((response) ->

      $selectTask = $("#task")
      $selectTracing = $("#tracing")

      # set autocompletion source for tracings domain input
      $("#training_domain").data("source", response.experiences)

      for aTask in response.tasks
        summary = aTask.type.summary || ""
        id = aTask.id
        $selectTask.append("<option value='#{id}'>#{summary} #{id}</option>")

      for aTracing in response.annotations
        id = aTracing.id
        optionString = aTracing.typ + " " + aTracing.dataSetName + " " + aTracing.created
        $selectTracing.append("<option value='#{id}'>#{optionString}</option>")


      @hideLoading()
    )


