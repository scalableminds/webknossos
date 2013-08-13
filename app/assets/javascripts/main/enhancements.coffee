### define
jquery : $
underscore : _
../libs/toast : Toast
###

$ ->

  # Progresssive enhancements
  $(document).on "click", "[data-newwindow]", (e) ->

    [ width, height ] = $(this).data("newwindow").split("x")
    window.open(this.href, "_blank", "width=#{width},height=#{height},location=no,menubar=no")
    e.preventDefault()

  # hover show/hide functionality
  $(document).on "hover", ".hover-dynamic", ->
    $(".hover-show", this).show()
    $(".hover-hide", this).hide()
  $(document).on "blur", ".hover-dynamic .hover-input", ->
    window.setTimeout(( =>
      $(this).parents(".hover-dynamic").find(".hover-show").hide()
      $(this).parents(".hover-dynamic").find(".hover-hide").show()),200)
  $(document).on "mouseleave", ".hover-dynamic", ->
    if not $(".hover-input:focus", this).length
      $(".hover-show", this).hide()
      $(".hover-hide", this).show()


  dataAjaxHandler = (event, element=null) ->
    event.preventDefault()
    
    $this = element or $(this)
    $form = if $this.is("form") then $this else $this.parents("form").first()

    options = {}
    for action in $this.data("ajax").split(",")
      [ key, value ] = action.split("=")
      options[key] = value ? true

    ajaxOptions =
      url : if $this.is("form") then $this.attr("action") else $this.attr("href")
      dataType : "json"

    if options["confirm"]
      if options["confirm"] != true
        message = options["confirm"]
      else
        message = "Are you sure?"
      return unless confirm(message)

    if options["method"]
      ajaxOptions["type"] = options.method

    if options["submit"]
      $validationGroup = if $this.is("form") then $this else $this.parents("form, [data-validation-group]").first()
      isValid = true
      $validationGroup.find(":input")
        .each( ->
          unless this.checkValidity()
            isValid = false
            Toast.error( $(this).data("invalid-message") || this.validationMessage )
        )
      return unless isValid
      ajaxOptions["type"] = options.method ? $form[0].method ? "POST"
      ajaxOptions["data"] = $form.serialize()
      ajaxOptions["contentType"] = "application/x-www-form-urlencoded; charset=UTF-8"

    if options["busy-class"]
      $this.addClass("busy")

    $.ajax(ajaxOptions).then(

      (responseData) ->

        { html, messages } = responseData

        if messages?
          Toast.message(messages)
        else
          Toast.success("Success :-)")

        $this.trigger("ajax-success", responseData)

        if options["replace-row"]
          $this.parents("tr").first().replaceWith(html)

        if options["delete-row"]
          if $this.parents("table").first().hasClass("table-details")
            $this.parents("tr").first().next().remove()
          $this.parents("tr").first().remove()

        if options["add-row"]
          $(options["add-row"]).find("tbody").append(html)

        if options["replace"]
          $(options["replace"]).replaceWith(html)

        if options["replace-table"]
          $(options["replace-table"]).replaceWith(html)

        if options["delete-parent"]?
          if options["delete-parent"] != true
            $this.parents(options["delete-parent"]).first().remove()
          else
            $this.parent().remove()

        if options["reload"]
          window.location.reload()

        if options["redirect"]
          setTimeout(
            -> window.location.href = options["redirect"]
            500
          )

        $this.trigger("ajax-after", responseData)

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
    ).always(
      ->
        $this.removeClass("busy")
    )

  $(document).on "click", "a[data-ajax]", dataAjaxHandler
  $(document).on "submit", "form[data-ajax]", dataAjaxHandler


  $(document).on "change", "table input.select-all-rows", ->

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



    $(document).on "change", "table input.select-row", ->

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

  if window.location.hash
    $(window.location.hash).addClass("highlighted")

  $(window).on "hashchange", ->
    $(".highlighted").removeClass("highlighted")
    $(window.location.hash).addClass("highlighted")


  $("table.table-details").each ->

    $table = $(this)

    $table.find(".details-row").addClass("hide")

    $table.find(".details-toggle").click (event) ->
      $toggle = $(this)

      dataAjaxHandler(event, $toggle)

      newState = !$toggle.hasClass("open")

      $toggle.parents("tr").next().toggleClass("hide", !newState)
      $toggle.toggleClass("open", newState)


    $table.find(".details-toggle-all").click ->

      $toggle = $(this)
      newState = !$toggle.hasClass("open")

      $table.find(".details-row").toggleClass("hide", !newState)
      $table.find(".details-toggle").toggleClass("open", newState)
      $toggle.toggleClass("open", newState)


  highlightToasts = ->

    highlight = (target) =>

      for i in [0..5]
        target.animate({right: "+=20px"}, 30).animate({right: "-=20px"}, 30)
      setTimeout(
        => highlight(target)
        5000
      )

    newTarget = $("div.alert-error:not(.highlighted)").addClass("highlighted")
    if newTarget.length then highlight(newTarget)

  $("#alert-container").on "DOMSubtreeModified", (event) ->
    highlightToasts()

  highlightToasts()

  # Show modal-message if present, has to be appended to the body, according to bootstrap manual
  $(".modal-message").appendTo("body").modal("show")
