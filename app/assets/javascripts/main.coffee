# -----------------------------------------------
# MAIN
# -----------------------------------------------
# DISCLAMER :
# If you're used to Backbone.js, you may be
# confused by the absence of models, but the goal
# of this sample is to demonstrate some features
# of Play including the template engine.
# I'm not using client-side templating nor models
# for this purpose, and I do not recommend this
# behavior for real life projects.
# -----------------------------------------------

# Just a log helper
log = (args...) ->
    console.log.apply console, args if console.log?

# ------------------------------- DROP DOWN MENUS
$(".options dt, .users dt").live "click", (e) ->
    e.preventDefault()
    if $(e.target).parent().hasClass("opened")
        $(e.target).parent().removeClass("opened")
    else
        $(e.target).parent().addClass("opened")
        $(document).one "click", ->
            $(e.target).parent().removeClass("opened")
    false

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


$.fn.alertWithTimeout = (timeout = 3000) ->

    this.each ->

        $this = $(this)
        $this.alert()
        timerId = -1

        $this.hover(
            ->
                clearTimeout(timerId)
            -> 
                timerId = setTimeout(
                    -> $this.alert("close")
                    timeout
                )
        )
        $(window).one "mousemove", -> $this.mouseout()


toastMessage = (type, message, sticky = false) ->

    $messageElement = $("<div>", class : "alert alert-#{type} fade in").html(message)
    $messageElement.prepend($("<a>", class : "close", "data-dismiss" : "alert", href : "#").html("&times;"))
    if sticky
        $messageElement.alert()
    else
        $messageElement.alertWithTimeout()
    $("#alert-container").append($messageElement)


toastSuccess = (message, sticky) -> toastMessage("success", message, sticky)
toastError = (message, sticky = true) -> toastMessage("error", message, sticky)


# ------------------------------------- INIT APP
$ -> # document is ready!

    $("#issue-submit-button").click (e) ->
        window.open(this.href, "_blank", "width=700,height=470,location=no,menubar=no")
        e.preventDefault()

    $("#user-administration").each ->

        $(this).find(".verify-button").click (event) ->

            event.preventDefault()
            $this = $(this)
            $.ajax(url : this.href).then(
                -> 
                    toastSuccess("Successfully verified \"#{$this.parents("tr").data("name")}\".")
                    $this.html("<i class=\"icon-ok\"></i>")
                ->
                    toastError("Couldn't verify user :-/")
            )


    $("#task-selection-algoritm").each ->

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
                    toastSuccess("Saved!")
                ->
                    toastError(
                        """Sorry, we couldn't save your code. Please double check your syntax.<br/>
                        Otherwise, please copy your code changes and reload this page."""
                        true
                    )
            )

