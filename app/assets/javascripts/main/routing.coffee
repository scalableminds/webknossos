### define
jquery : $
underscore : _
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

      $("#nml-explore-form").each ->

        $form = $(this)

        $form.find("[type=submit]").click (event) ->

          event.preventDefault()
          $input = $("<input>", type : "file", name : "nmlFile", class : "hide")

          $input.change ->
            if this.files.length
              $form.append(this)
              $form.submit()

          $input.click()


      $("a[rel=popover]").popover()


    "oxalis.trace" : ->

      require [
        "./controller"
        "./core_ext"
        "three"
        "stats"
      ], (Controller) ->

        oxalis = window.oxalis = new Controller()
        return


        $("#trace-finish-button, #trace-download-button").click (event) ->

          event.preventDefault()

          oxalis.gui.saveNow().done =>
            window.location.href = this.href


        $("#trace-save-button").click (event) ->

          event.preventDefault()
          oxalis.gui.saveNow()


    "admin.task.taskOverview" : ->

      require [ "worker!libs/viz" ], (VizWorker) ->

        graphSource = $("#graphData").html()
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
            $(".graph").html("<i class=\"icon-warning-sign\"></i> #{error}")
        )


    "admin.task.taskSelectionAlgorithm" : ->

      $this = $(this)
      $form = $this.find("form")
      $submitButton = $this.find("[type=submit]")

      require ["libs/ace/ace"], (ace) ->

        editor = ace.edit("editor")
        editor.setTheme("ace/theme/twilight");
        editor.getSession().setMode("ace/mode/javascript");


        editor.on "change", ->

          try
            new Function(editor.getValue())
            $submitButton.removeClass("disabled").popover("destroy")

          catch error
            $submitButton.addClass("disabled")
            $submitButton.popover(
              placement : "right"
              title : "No good code. No save."
              content : error.toString()
              trigger : "hover"
            )

        editor._emit("change") # init

        $form.submit (event) ->

          event.preventDefault()

          return if $submitButton.hasClass("disabled")

          code = editor.getValue()

          $form.find("[name=code]").val(code)

          $.ajax(
            url : this.action
            data : $form.serialize()
            type : "POST"
          ).then(
            ->
              Toast.success("Saved!")
            ->
              Toast.error(
                """Sorry, we couldn't save your code. Please double check your syntax.<br/>
                Otherwise, please copy your code changes and reload this page."""
                true
              )
          )


    "admin.creator.levelCreator" : ->

      require ["level_creator"], (LevelCreator) ->

        window.levelCreator = new LevelCreator()
