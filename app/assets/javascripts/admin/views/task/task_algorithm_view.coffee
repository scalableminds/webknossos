### define
underscore : _
backbone.marionette : marionette
keyboard : KeyboardJS
ace : ace
libs/toast : Toast
###

class TaskAlgorithmView extends Backbone.Marionette.View

  events :
    "submit @ui.form" : "save"

  ui :
    "form" : "form"
    "submitButton" : "input[type=submit]"


  initialize : ->

    @bindUIElements() #Backbone.Marionette internal method

    @initAce()
    @editor.on "change", =>

      try
        new Function(@editor.getValue())
        @ui.submitButton.removeClass("disabled").popover("destroy")
        @isValid = true

      catch error
        @ui.submitButton.addClass("disabled")
        @ui.submitButton.popover(
          placement : "right"
          title : "No good code. No save."
          content : error.toString()
          trigger : "hover"
        )
        @isValid = false

    @editor._emit("change") # init

    @editor.on "change", -> @isDirty = true

    $(window).on "beforeunload", (event) ->

      "You have unsaved code. Do you really want to leave this site?" if @isDirty


    KeyboardJS.on "super+s,ctrl+s", (event) ->

      event.preventDefault()
      event.stopPropagation()
      @save()


  initAce : ->

    @editor = ace.edit("editor")
    @editor.setTheme("ace/theme/twilight");
    @editor.getSession().setMode("ace/mode/javascript");

    @isValid = true
    @isDirty = false


  save : (event) ->

    event.preventDefault()
    return if @ui.submitButton.hasClass("disabled")

    code = @editor.getValue()

    @ui.form.find("[name=code]").val(code)

    $.ajax(
      url : @ui.form.attr("action")
      data : @ui.form.serialize()
      type : "POST"
    ).then(
      ->
        @isDirty = false
        Toast.success("Saved!")
      ->
        Toast.error(
          """Sorry, we couldn't save your code. Please double check your syntax.<br/>
          Otherwise, please copy your code changes and reload this page."""
          true
        )
    )


  remove : ->

    super()
    @editor.off "change"
    KeyboardJS.off "super+s,ctrl+s"
