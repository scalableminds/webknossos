
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

route = (routes) ->

    url = window.location.pathname.substring(1)

    #if _.isFunction(routes[url])
    if routes[url]?
        routes[url].call($("#main-container")[0])
    return


# ------------------------------------- INIT APP
$ -> # document is ready!

    # Progresssive enhancements
    $("[data-newwindow]").click (e) ->

        [ width, height ] = $(this).data("newwindow").split("x")
        window.open(this.href, "_blank", "width=#{width},height=#{height},location=no,menubar=no")
        e.preventDefault()


    $("a[data-ajax]").click (event) ->
        
        event.preventDefault()
        $this = $(this)
        $.ajax(url : this.href, dataType : "json").then(

            ({ html, message }) ->

                toastSuccess(message || "Success :-)")
                $this.trigger("ajax-success", message)

                for action in $this.data("ajax").split(",")
                    switch action
                        when "replace-row" then $this.parents("tr").replaceWith(html)
                        when "reload" then window.location.reload()

            ({ message }) ->
                toastError(message || "Error :-(")
                $this.trigger("ajax-error", message)
        )


    $("form[data-ajax]").submit (event) ->

        event.preventDefault()
        $this = $(this)
        $.ajax(
            url : this.action
            type : this.method || "POST"
            data : $this.serialize()
            dataType : "json"
        ).then(

            ({ html, message }) ->
                toastSuccess(message || "Success :-)")
                $this.trigger("ajax-success", message)

            ({ message }) ->
                toastError(message || "Error :-(")
                $this.trigger("ajax-error", message)
        )


    # Page specifics
    route

        "dashboard" : ->

            # $.ajax(
            #     type : "POST"
            #     url : "/experiment?id=#{experiment.id}&isNew=#{Number(experiment.isNew)}"
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
                        toastSuccess("Saved!")
                    ->
                        toastError(
                            """Sorry, we couldn't save your code. Please double check your syntax.<br/>
                            Otherwise, please copy your code changes and reload this page."""
                            true
                        )
                )


