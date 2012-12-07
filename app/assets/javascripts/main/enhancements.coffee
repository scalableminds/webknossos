### define 
jquery : $
underscore : _
../libs/toast : Toast
###

$ ->

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
        return
      


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


