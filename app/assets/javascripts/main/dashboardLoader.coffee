### define
jquery : $
underscore : _
main/routing_utils : RoutingUtils
libs/input : Input
routes : routes
###

DashboardLoader =

  displayUserDashboard : ->

    new Input.KeyboardNoLoop(
      "v" : ->
        $("#tracing-chooser").toggleClass("hide")
    )


    $("#nml-explore-form").each ->

      $form = $(this)

      $form.find("[type=submit]").click (event) ->

        event.preventDefault()
        $input = $("<input>", type : "file", name : "nmlFile", class : "hide", multiple : "")

        $input.change ->
          if this.files.length
            $form.append(this)
            $form.submit()

        $input.click()


    $("a[rel=popover]").popover()

    # confirm new task, when there already is an open one
    $("#new-task-button").on("ajax-after", (event) ->

      $(this).data("ajax", "add-row=#dashboard-tasks,confirm=Do you really want another task?")

    )

    # remove confirmation, when there is no open task left
    $("#dashboard-tasks").on("ajax-success", ".trace-finish", (event, responseData) ->

      if responseData["hasAnOpenTask"] == false
        $("#new-task-button").data("ajax", "add-row=#dashboard-tasks")

    )

  displayBasicDashboard : ->

    RoutingUtils.maskFinishedTasks()

    extractTemplate = (table) =>

      $tableBody = table.find("tbody").find("template")
      taskTRTemplate = $tableBody.html()
      taskTRTemplate = _.unescape(taskTRTemplate)
      @template = _.template(taskTRTemplate)

    $dashboardTasks = $("#dashboard-tasks")
    $explorativeTasks = $("#explorative-tasks")


    populateTemplate = (data, table, contextProvider) =>
      extractTemplate(table)

      $tableBody = table.find("tbody")

      tableItems = for el in data
        @template(contextProvider(el))

      $tableBody.removeClass("hide").prepend(tableItems)


    $tabbableDashboard = $("tabbable-dashboard")
    # TODO replace with route
    # not working currently?
    # url = $tabbableDashboard.data("url")

    url = "/getDashboardInfo"

    $.get(url).done((response) =>

      # tasks
      populateTemplate(response.data.tasks, $dashboardTasks, (el) ->
        return {
          annotations: el.annotation,
          tasks: el.tasks
        }
      )

      populateTemplate(response.data.exploratory, $explorativeTasks, (el) ->
        return { annotations: el }
      )

      @hideLoading()

    )

  hideLoading : ->

    $("#loader").css("display" : "none")