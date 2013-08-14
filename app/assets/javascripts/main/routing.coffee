### define
jquery : $
underscore : _
libs/toast : Toast
libs/keyboard : KeyboardJS
main/routing_utils : RoutingUtils
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

        oxalis = window.oxalis = new Controller()

        return

    "admin.task.taskList" : ->

      require ["libs/jquery.bootpag.min"], ->
        pageSelection = $("#page-selection")
        
        ajaxOptions =
          url : pageSelection.data("url")
          dataType : "json"
          type : "get"
        
        jsonTasks = null

        JSONcontains = (data, query, valuesToConsider=null) ->
          # TODO valuesToConsider could be a json which contains which values should be searched

          for own key, value of data
            # which keys should be searched? use valuesToConsider ?

            if _.isObject(value) or _.isArray(value)
              return JSONcontains value, query

            if _.isNumber(value) or _.isString(value)
              # stringify
              value += ''
              if value.indexOf(query) > -1
                return true
          return false
        
        tbody = $("#main-container > div > table > tbody")

        $("#searchbox").keypress ->
          query = $(this).val()
          results = []

          for task in jsonTasks
            if JSONcontains task, query
              results.push task

          displayJSON results

          console.log results
          console.log query


        generateHTML = (element) ->

          formatDate = (timestamp) ->
            # like 2013-02-03 18:29
            return timestamp

          #  href="@controllers.admin.routes.AnnotationAdministration.annotationsForTask(task.id)" data-ajax="add-row=#@task.id + tr"

          """
          <tr id="#{element._id.$oid}">
            <td class="details-toggle" href="@controllers.admin.routes.AnnotationAdministration.annotationsForTask(task.id)" data-ajax="add-row=##{element._id.$oid} + tr"> <i class="caret-right"></i> <i class="caret-down"></i> </td>
            <td> ? # like ? 7ff024 is it #{element._id.$oid} ?</td>
            <td> ? H-Id like ? 0 </td>
            <td> 
                <a href="/admin/projects#tracingMethodsComparison">
                  ? project like ? tracingMethodsComparison
                </a>
            </td>
            <td> 
              <a href="/admin/taskTypes#5113621ce4b02448f8a1784d">
                ? type like ? methodComaprison_regularTracing 
              </a>
            </td>
            <td> ? data set like ? 2012-09-28_ex145_07x2 </td>
            <td> ? edit position like ? (6369, 2924, 1) </td>
            <td> <span class="label"> #{element.neededExperience.domain}: #{element.neededExperience.value} </span> </td>
            <td> #{element.priority} </td>
            <td> #{formatDate element._taskType.created} </td>
            <td>
                <i class="icon-play-circle"></i> ? open
                <br>
                <i class="icon-random"></i> ? active
                <br>
                <i class="icon-ok-circle"></i> ? done
            </td>
            <td class="nowrap">
              <a href="/admin/tasks/#{element._id.$oid} ?oder? #{element._taskType.$oid}/edit"><i class="icon-pencil"></i> edit </a><br>
              <a href="/annotations/CompoundTask/#{element._id.$oid} ?oder? #{element._taskType.$oid}" title="view all finished tracings"><i class="icon-random"></i> view </a><br>
              <a href="/admin/tasks/#{element._id.$oid} ?oder? #{element._taskType.$oid}/download" title="download all finished tracings"><i class="icon-download"></i> download </a><br>
              <a href="/admin/trainingsTasks/create?taskId=#{element._id.$oid} ?oder? #{element._taskType.$oid}"><i class="icon-road"></i> use for Training </a><br>
              <a href="/admin/tasks/#{element._id.$oid} ?oder? #{element._taskType.$oid}/delete" data-ajax="delete-row,confirm"><i class="icon-trash"></i> delete </a>
            </td>
          </tr>
          """

        displayJSON = (jsonArray) ->
          htmlArray = []
          
          for element in jsonArray
            htmlArray.push generateHTML(element)

          tbody.html(htmlArray.join(""))

        $.ajax(ajaxOptions).then(

          (responseData) ->
            jsonTasks = responseData
            console.log jsonTasks

            pageCount = 20
            rowsPerPage = Math.ceil jsonTasks.length / pageCount
            

            
            
            pageSelectionHandler = (event, number) ->
              index = number - 1
              json = jsonTasks.slice(rowsPerPage * index, rowsPerPage * (index + 1))
              displayJSON json
            
            pageSelection.bootpag({total: pageCount}).on "page", pageSelectionHandler

            # activate the first page
            pageSelectionHandler null, 1

            return
        )


        return


    "admin.task.taskOverview" : ->

      require [ "worker!libs/viz", "svgpan" ], (VizWorker, svgPan) ->

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
            $svg[0].setAttribute("viewBox", "0 0 0 0")
            $svg[0].setAttribute("width", "100%")
            $svg[0].setAttribute("height", "100%")
            $svg.css("max-width", "100%")

            $svg.svgPan("graph1")

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
