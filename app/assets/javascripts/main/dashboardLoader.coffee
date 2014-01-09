### define
jquery : $
underscore : _
main/routing_utils : RoutingUtils
###

DashboardLoader =

  displayUserDashboard : ->

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

    extractTemplate = (table) ->

      $tableBody = table.find("tbody")
      taskTRTemplate = $tableBody.html()
      $tableBody.empty()
      
      table.data("tr-template", taskTRTemplate)

    $dashboardTasks = $("#dashboard-tasks")
    $explorativeTasks = $("#explorative-tasks")

    for aTable in [$dashboardTasks, $explorativeTasks]
      extractTemplate(aTable)

    populateTemplate = (data, table, contextProvider) ->

      $tableBody = table.find("tbody")
      templateSource = _.unescape(table.data("tr-template"))
      templateFn = _.template(templateSource)
      
      outputHTML = []

      for el in data
        outputHTML.push(templateFn(contextProvider(el)))

      $tableBody.removeClass("hide").html(outputHTML.join(""))


    $tabbableDashboard = $("tabbable-dashboard")
    # TODO replace with route
    # not working currently?
    # url = $tabbableDashboard.data("url")

    url = "/getDashboardInfo"

    $.get(url).done((response) ->

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

    )
