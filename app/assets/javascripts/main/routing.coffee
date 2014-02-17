### define
jquery : $
underscore : _
libs/toast : Toast
libs/keyboard : KeyboardJS
libs/pan_zoom_svg : PanZoomSVG
main/routing_utils : RoutingUtils
oxalis/constants : constants
./paginator : Paginator
./dashboardLoader : DashboardLoader
###

$ ->

  route = (routes) ->

    javaTemplate = $("#main-container").data("template")

    javaTemplate = javaTemplate.match(/^([^\$]*)/)[1]

    if routes[javaTemplate]?
      routes[javaTemplate].call($("#main-container")[0])
    else
      hideLoading()

    return

  hideLoading = ->

    $("#loader").css("display" : "none")


  route

    "views.html.user.dashboard.userDashboard" : ->

      DashboardLoader.displayBasicDashboard()
      DashboardLoader.displayUserDashboard()

      return

    "views.html.admin.user.user" : ->

      DashboardLoader.displayBasicDashboard()

      return

    "views.html.admin.taskType.taskTypes" : ->

      hideLoading()

    "views.html.tracing.trace" : ->

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
            populateTemplate({task : null})

          complete: (task) ->

            oxalis = window.oxalis = new Controller(constants.CONTROL_MODE_TRACE)
        )

        return

    "views.html.tracing.view" : ->

      require [
        "./oxalis/controller"
        "./libs/core_ext"
        "three"
        "stats"
        "slider"
      ], (Controller) ->

        oxalis = window.oxalis = new Controller(constants.CONTROL_MODE_VIEW)

        return


    "views.html.admin.binary.dataSetList" : ->

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

      return hideLoading()


    "views.html.admin.task.taskOverview" : ->

      require [ "worker!libs/viz.js" ], (VizWorker) ->

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

            hideLoading()

          (error) ->
            $(".graph").html("<i class=\"fa fa-warning-sign\"></i> #{error.replace(/\n/g,"<br>")}")
        )

    "controllers.UserController" : ->

      require ["./admin/views/user/user_list_view"], (UserListView) =>

        view = new UserListView().render()
        $(this).html(view.el)

      # $modal = $(".modal")

      # #teampicker only
      # $modal.on "change", "select[name=teams]", ->
      #   #add a new team / role pair
      #   $template = $modal.find(".team-role-pair").first()
      #   $newRow = $template.clone()
      #   $newRow.insertAfter($template)

      # $(".show-modal").on "click", ->

      #   templateId = $(this).data("template")
      #   showModal(templateId)

      # showModal = (templateId) ->

      #   template = $("##{templateId}")
      #   title = template.data("header")

      #   $modal.find(".modal-body").html(template.html())
      #   $modal.find(".modal-header h3").text(title)
      #   $modal.find(".modal-hide").on "click", -> $modal.modal("hide")

      #   $modal.modal("show")


      # $("form").on "click", ".label-experience", (event) ->
      #   values = $(this).html().split(" ")
      #   if values
      #     showModal("experiencepicker")
      #     $modal = $(".modal")

      #     $modal.find("input[name=experience-domain]").attr("value", values[0])
      #     $modal.find("input[name=experience-value]").attr("value", values[1])
      #     $(this).parents("table").find("input[type=checkbox]").attr('checked', false)
      #     $(this).parents("tr").find("input[type=checkbox]").attr('checked', true)

      return hideLoading()


    "views.html.admin.task.taskSelectionAlgorithm" : ->

      $this = $(this)
      $form = $this.find("form")
      $submitButton = $this.find("[type=submit]")

      require ["libs/ace/ace"], (ace) ->

        editor = ace.edit("editor")
        editor.setTheme("ace/theme/twilight");
        editor.getSession().setMode("ace/mode/javascript");

        isValid = true
        isDirty = false

        editor.on "change", ->

          try
            new Function(editor.getValue())
            $submitButton.removeClass("disabled").popover("destroy")
            isValid = true

          catch error
            $submitButton.addClass("disabled")
            $submitButton.popover(
              placement : "right"
              title : "No good code. No save."
              content : error.toString()
              trigger : "hover"
            )
            isValid = false

        editor._emit("change") # init


        editor.on "change", -> isDirty = true

        $(window).on "beforeunload", (event) ->

          "You have unsaved code. Do you really want to leave this site?" if isDirty


        save = ->

          return if $submitButton.hasClass("disabled")

          code = editor.getValue()

          $form.find("[name=code]").val(code)

          $.ajax(
            url : $form.attr("action")
            data : $form.serialize()
            type : "POST"
          ).then(
            ->
              isDirty = false
              Toast.success("Saved!")
            ->
              Toast.error(
                """Sorry, we couldn't save your code. Please double check your syntax.<br/>
                Otherwise, please copy your code changes and reload this page."""
                true
              )
          )

        KeyboardJS.on "super+s,ctrl+s", (event) ->

          event.preventDefault()
          event.stopPropagation()
          save()


        $form.submit (event) ->

          event.preventDefault()
          save()

        hideLoading()

    "views.html.levelcreator.levelCreator" : ->

      require ["./level_creator"], (LevelCreator) ->

        window.levelCreator = new LevelCreator()
        hideLoading()

    "views.html.admin.project.projectList" : ->

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

    "views.html.admin.training.trainingsTaskCreate" : ->

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


        hideLoading()
      )
