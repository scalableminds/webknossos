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
        $this.on 
            "mouseover" : -> clearTimeout(timerId)
            "mouseout" : -> 
                timerId = setTimeout(
                    -> $this.alert("close")
                    timeout
                )
        $this.mouseout()

toastMessage = (type, message) ->

    $messageElement = $("<div>", class : "alert alert-#{type} fade in").text(message)
    $messageElement.append($("<a>", class : "close", "data-dismiss" : "alert", href : "#").html("&times;"))
    $messageElement.alertWithTimeout()
    $("#alert-container").append($messageElement)


# ------------------------------------- INIT APP
$ -> # document is ready!

    $("#issue-submit-button").click (e) ->
        window.open(this.href, "_blank", "width=700,height=470,location=no,menubar=no")
        e.preventDefault()


    $("#task-selection-algoritm").each ->

        $this = $(this)

        editor = ace.edit("editor")
        editor.setTheme("ace/theme/twilight");
        editor.getSession().setMode("ace/mode/javascript");

        submitButton = $this.find("[type=submit]")

        editor.on "change", ->

            try
                new Function(editor.getValue())
                submitButton.removeClass("disabled").popover("destroy")
            catch error                
                submitButton.addClass("disabled")
                submitButton.popover(
                    placement : "left"
                    title : "No good code. No save."
                    content : error.toString()
                    trigger : "hover"
                )

        editor._emit("change")
     
        $this.submit (event) ->

            event.preventDefault()

            return if $this.find("[type=submit]").hasClass("disabled")

            code = editor.getValue()

            $this.find("[name=code]").val(code)

            $.ajax(
                url : this.action
                data : $this.serialize()
                type : "POST"
            ).then(
                -> 
                    toastMessage("success", "Saved!")
                ->
                    toastMessage("error" ,"Sorry, we couldn't save your code. Please double check your syntax.\nOtherwise, please copy your code changes and reload this page.")
            )

