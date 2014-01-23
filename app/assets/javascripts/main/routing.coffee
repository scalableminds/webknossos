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

    javaTemplate = javaTemplate.match(/views\.html\.(.*)\$/)[1]

    if routes[javaTemplate]?
      routes[javaTemplate].call($("#main-container")[0])
    else
      hideLoading()

    return

  hideLoading = ->

    $("#loader").css("display" : "none")


  route

    "user.dashboard.userDashboard" : ->

      DashboardLoader.displayBasicDashboard()
      DashboardLoader.displayUserDashboard()

      return

    "admin.user.user" : ->

      DashboardLoader.displayBasicDashboard()

      return

    "admin.taskType.taskTypes" : ->

      hideLoading()

    "tracing.trace" : ->

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

    "tracing.view" : ->

      require [
        "./oxalis/controller"
        "./libs/core_ext"
        "three"
        "stats"
        "slider"
      ], (Controller) ->

        oxalis = window.oxalis = new Controller(constants.CONTROL_MODE_VIEW)

        return


    "admin.task.taskOverview" : ->

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
            $(".graph").html("<i class=\"icon-warning-sign\"></i> #{error.replace(/\n/g,"<br>")}")
        )


    # "admin.user.userAdministration" : ->
      # TODO: does "admin.user.userAdministration" still exist or has it been replaced by "userList" ?

    "admin.user.userList" : ->
      require ["multiselect"], ->

        $popovers = $("a[rel=popover]")
        template = """
                   <form class="form-inline">
        #{$("#single-teampicker").html()}
                   </form>
                   """

        $popovers.popover(
          content: template
        )

        $popovers.on "click", ->

          $this = $(@)
          url = $this.data("url")
          rowId = $this.closest("tr").data("id")

          $(".popover").find("a")
            .attr("href", url)
            .attr("data-ajax", "method=POST,submit,replace=##{rowId}")

          $(".popover").find(".multiselect")
            .multiselect(
              buttonWidth: "200px"
            )

          $(".popover").find(".popover-hide").on "click", -> $this.popover("hide")


        $("#bulk-actions a").on "click", ->

          $this = $(@)
          templateId = $this.data("template")
          showModal(templateId)

        showModal = (templateId) ->

          template = $("##{templateId}")
          title = template.data("header")

          $modal = $(".modal")

          $modal.find(".modal-body").html(template.html())
          $modal.find(".modal-header h3").text(title)
          $modal.find(".modal-hide").on "click", -> $modal.modal("hide")
          $modal.find(".multiselect").multiselect()

          $modal.modal("show")



        $("form").on "click", ".label-experience", (event) ->
          values = $(this).html().split(" ")
          if values
            showModal("experiencepicker")
            $modal = $(".modal")

            $modal.find("input[name=experience-domain]").attr("value", values[0])
            $modal.find("input[name=experience-value]").attr("value", values[1])
            $(this).parents("table").find("input[type=checkbox]").attr('checked', false)
            $(this).parents("tr").find("input[type=checkbox]").attr('checked', true)

        hideLoading()
      return


    "admin.task.taskSelectionAlgorithm" : ->

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

    "levelcreator.levelCreator" : ->

      require ["./level_creator"], (LevelCreator) ->

        window.levelCreator = new LevelCreator()
        hideLoading()

    "admin.project.projectList" : ->

      preparePaginationData = (projects, users) ->

        for aProject, index in projects

          id = aProject._owner.$oid
          owner = _.find(users, (u) -> u._id.$oid == id)

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
          $owner.append("<option value='#{aUser._id.$oid}' selected=''>#{aUser.firstName} #{aUser.lastName}</option>")
      )

    "admin.training.trainingsTaskCreate" : ->

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
