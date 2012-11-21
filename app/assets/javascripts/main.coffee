require.config 
  
  baseUrl : "/assets/javascripts"
  paths :
    "jquery" : "libs/jquery-1.7.1"
    "underscore" : "libs/underscore-1.2.0.min"
    "bootstrap" : "libs/bootstrap.min"
  shim : 
    "underscore" :
      exports : "_"
    "bootstrap" : [ "jquery" ]

require [
  "jquery"
  "underscore"
  "view/toast"
  "bootstrap"
], ($, _, Toast) ->
     

  # Just a log helper
  log = (args...) ->
    console.log.apply console, args if console.log?

  # --------------------------------- EDIT IN PLACE
  $.fn.editInPlace = (method, options...) ->
    this.each ->
      methods = 
        # public methods
        init: (options) ->
          valid = (e) =>
            newValue = @input.val()
            options.onChange.call(options.context, newValue)
          cancel = (e) =>
            @el.show()
            @input.hide()
          @el = $(this).dblclick(methods.edit)
          @input = $("<input type='text' />")
            .insertBefore(@el)
            .keyup (e) ->
              switch(e.keyCode)
                # Enter key
                when 13 then $(this).blur()
                # Escape key
                when 27 then cancel(e)
            .blur(valid)
            .hide()
        edit: ->
          @input
            .val(@el.text())
            .show()
            .focus()
            .select()
          @el.hide()
        close: (newName) ->
          @el.text(newName).show()
          @input.hide()
      # jQuery approach: http://docs.jquery.com/Plugins/Authoring
      if ( methods[method] )
        return methods[ method ].apply(this, options)
      else if (typeof method == 'object')
        return methods.init.call(this, method)
      else
        $.error("Method " + method + " does not exist.")

  route = (routes) ->

    url = window.location.pathname.substring(1)

    #if _.isFunction(routes[url])
    if routes[url]?
      routes[url].call($("#main-container")[0])
    return


  # ------------------------------------- INIT APP
  $ -> # document is ready!

    # Progresssive enhancements
    $("[data-newwindow]").live "click", (e) ->

      [ width, height ] = $(this).data("newwindow").split("x")
      window.open(this.href, "_blank", "width=#{width},height=#{height},location=no,menubar=no")
      e.preventDefault()


    $("a[data-ajax]").live "click", (event) ->
      
      event.preventDefault()
      $this = $(this)

      options = {}
      for action in $this.data("ajax").split(",")
        [ key, value ] = action.split("=")
        options[key] = value ? true

      ajaxOptions = 
        url : this.href
        dataType : "json"

      if options["confirm"]
        return unless confirm("Are you sure?")

      if options["submit"]
        $form = $this.parents("form")
        ajaxOptions["type"] = $form[0].method ? "POST"
        ajaxOptions["data"] = $form.serialize()


      $.ajax(ajaxOptions).then(

        ({ html, messages }) ->

          if messages?
            Toast.message(messages)
          else
            Toast.success("Success :-)")

          $this.trigger("ajax-success", html, messages)

          if options["replace-row"] 
            $this.parents("tr").first().replaceWith(html)

          if options["delete-row"]
            if $this.parents("table").first().hasClass("table-details")
              $this.parents("tr").first().next().remove()
            $this.parents("tr").first().remove()

          if options["add-row"]
            $(options["add-row"]).find("tbody").append(html)

          if options["replace-table"]
            $(options["replace-table"]).replaceWith(html)

          if options["reload"]
            window.location.reload()

          if options["redirect"]
            setTimeout(
              -> window.location.href = options["redirect"]
              500
            )

          return

        (jqXHR) ->
          try
            data = JSON.parse(jqXHR.responseText)

          catch error
            return Toast.error("Internal Error :-(")

          if (messages = data.messages)?
            Toast.message(messages)
          else
            Toast.error("Error :-/")

          $this.trigger("ajax-error", messages)
      )
    

    $("table input.select-all-rows").live "change", ->

      $this = $(this)
      $this.parents("table").find("tbody input.select-row").prop("checked", this.checked)
      return


    do ->

      shiftKeyPressed = false
      $(document).on 
        "keydown" : (event) ->
          shiftKeyPressed = event.shiftKey
          return

        "keyup" : (event) ->
          if shiftKeyPressed and (event.which == 16 or event.which == 91)
            shiftKeyPressed = false
        


      $("table input.select-row").live "change", ->

        $this = $(this)
        $table = $this.parents("table").first()
        $row = $this.parents("tr").first()

        if (selectRowLast = $table.data("select-row-last")) and shiftKeyPressed
          index = $row.prevAll().length
          rows = if index < selectRowLast.index
            $row.nextUntil(selectRowLast.el)
          else
            $row.prevUntil(selectRowLast.el)

          rows.find("input.select-row").prop("checked", this.checked)

          $table.data("select-row-last", null)
        else
          
          $table.data("select-row-last", { el : $row, index : $row.prevAll().length })

        return


    $("table.table-details").each ->

      $table = $(this)

      $table.find(".details-row").addClass("hide")

      $table.find(".details-toggle").click ->

        $toggle = $(this)
        newState = !$toggle.hasClass("open")

        $toggle.parents("tr").next().toggleClass("hide", !newState)
        $toggle.toggleClass("open", newState)


      $table.find(".details-toggle-all").click ->

        $toggle = $(this)
        newState = !$toggle.hasClass("open")

        $table.find(".details-row").toggleClass("hide", !newState)
        $table.find(".details-toggle").toggleClass("open", newState)
        $toggle.toggleClass("open", newState)




    # Page specifics
    route

      "dashboard" : ->

        $("a[rel=popover]").popover()

        # $.ajax(
        #     type : "POST"
        #     url : "/tracing?id=#{tracing.id}&isNew=#{Number(tracing.isNew)}"
        # )


      "admin/tasks/algorithm" : ->

        $this = $(this)
        $form = $this.find("form")
        $submitButton = $this.find("[type=submit]")

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
              placement : "left"
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
