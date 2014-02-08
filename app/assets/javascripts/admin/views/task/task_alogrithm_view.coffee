### define
underscore : _
backbone.marionette : marionette
libs/keyboard : KeyboardJS
libs/ace/ace : ace
###

class TaskAlogrithmView extends Backbone.Marionette.View

  tagName = "div"
  className : "container"
  attributes :
    id : "task-selection-algoritm"

  template : _.template("""
    <h3>Tasks Selection Algorithm</h3>
    <div>
      <p>
        The task selection algorithm definies, which task a user gets assigned next.
        The default behaviour is to take the first applicable task available,
        but it is possible to customize the behaviour here.
      </p>
    </div>
    <form action="/admin/tasks/algorithm" method="POST">
      <input type="submit" value="Save" class="btn btn-primary">
      <input type="hidden" name="code" />
      <input type="hidden" name="use" value="1" />

      <div class="editor-wrapper">
        <div id="editor"></div>
      </div>
    </form>
  """)

  events :
    "submit @ui.form" : "save"

  ui :
    "form" : "form"
    "submitButton" : "[type=submit]"


  initialize : ->

    @initAce()
    @editor.on "change", ->

      try
        new Function(@editor.getValue())
        $submitButton.removeClass("disabled").popover("destroy")
        @isValid = true

      catch error
        $submitButton.addClass("disabled")
        $submitButton.popover(
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
