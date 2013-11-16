### define
jquery : $
underscore : _
libs/toast : Toast
libs/keyboard : KeyboardJS
libs/pan_zoom_svg : PanZoomSVG
main/routing_utils : RoutingUtils
oxalis/constants : constants
###

$ ->

  route = (routes) ->

    javaTemplate = $("#main-container").data("template")

    javaTemplate = javaTemplate.match(/views\.html\.(.*)\$/)[1]

    if routes[javaTemplate]?
      routes[javaTemplate].call($("#main-container")[0])
    return


  route

    "user.dashboard.userDashboard" : ->

      RoutingUtils.maskFinishedTasks()

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
      $("#new-task-button").on "ajax-after", (event) ->

        $(this).data("ajax", "add-row=#dashboard-tasks,confirm=Do you really want another task?")

      # remove confirmation, when there is no open task left
      $("#dashboard-tasks").on "ajax-success", ".trace-finish", (event, responseData) ->

        if responseData["hasAnOpenTask"] == false
          $("#new-task-button").data("ajax", "add-row=#dashboard-tasks")

      return

    "tracing.trace" : ->

      require [
        "./oxalis/controller"
        "./libs/core_ext"
        "three"
        "stats"
      ], (Controller) ->

        oxalis = window.oxalis = new Controller(constants.CONTROL_MODE_TRACE)

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

      require [ "worker!libs/viz" ], (VizWorker) ->

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

          (error) ->
            $(".graph").html("<i class=\"icon-warning-sign\"></i> #{error.replace(/\n/g,"<br>")}")
        )

    "admin.user.user" : ->

      RoutingUtils.maskFinishedTasks()

      return

    "admin.user.userAdministration" : ->
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


    "levelcreator.levelCreator" : ->

      require ["./level_creator"], (LevelCreator) ->

        window.levelCreator = new LevelCreator()
