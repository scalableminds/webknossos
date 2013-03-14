### define
jquery : $
underscore : _
libs/toast : Toast
libs/keyboard : KeyboardJS
###

$ ->

  route = (routes) ->

    javaTemplate = $("#main-container").data("template")

    javaTemplate = javaTemplate.match(/views\.html\.(.*)\$/)[1]

    if routes[javaTemplate]?
      routes[javaTemplate].call($("#main-container")[0])
    return


  route

    "user.dashboard.dashboard" : ->

      # initialize/toggling for finished tasks
      $("#dashboard-tasks").find(".finished").addClass("hide")
      $("#toggle-finished").click ->

        $toggle = $(this)
        newState = !$toggle.hasClass("open")

        description = if newState then "Hide finished tasks" else "Show finished tasks"
        $toggle.text(description)

        $("#dashboard-tasks").find(".finished").toggleClass("hide", !newState)
        $("#dashboard-tasks").find(".finished").toggleClass("open", newState)
        $toggle.toggleClass("open", newState)

      # initialize masking for newly finished tasks
      $("#dashboard-tasks").on "DOMSubtreeModified", (event) ->

        initialState = if $("#toggle-finished").hasClass("open") then "open" else "hide"
        $(".finished:not(.open):not(.hide)").addClass(initialState)

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

    "oxalis.trace" : ->

      require [
        "./oxalis/controller"
        "./libs/core_ext"
        "three"
        "stats"
      ], (Controller) ->

        oxalis = window.oxalis = new Controller()
        
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

            $(".graph").html(svgResult)

            userData.map (user) ->
              $("#" + user.id + " > text").popover(
                title: user.name,
                html: true,
                trigger: "hover",
                content: user.tooltip
              )

          (error) ->
            $(".graph").html("<i class=\"icon-warning-sign\"></i> #{error.replace(/\n/g,"<br>")}")
        )


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
