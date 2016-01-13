_             = require("lodash")
Marionette    = require("backbone.marionette")
routes        = require("routes")
Toast         = require("libs/toast")
Request       = require("libs/request")

class TaskCreateFromNMLView extends Marionette.LayoutView

  id: "create-from-nml"
  API_URL: "/api/tasks-nml"

  # clear all form inputs when task was successfully created
  CLEAR_ON_SUCCESS : true

  template: _.template("""

  <div class="form-group">
    <label class="col-sm-2 control-label" for="nmlFile">Reference NML File</label>
    <div class="col-sm-9">
      <div class="fileinput fileinput-new input-group" data-provides="fileinput">
        <div class="form-control" data-trigger="fileinput">
          <i class="fa fa-file fileinput-exists"></i>
          <span class="fileinput-filename"></span>
        </div>
        <span class="input-group-addon btn btn-default btn-file">
          <span class="fileinput-new">Browse...</span>
          <span class="fileinput-exists">Change</span>
          <input type="file" multiple="" name="nmlFiles[]" title="Please select at least one .nml file" required=true>
        </span>
        <a href="#" class="input-group-addon btn btn-default fileinput-exists" data-dismiss="fileinput">Remove</a>
      </div>
    </div>
  </div>


  """)

  initialize: (options) ->

    @parent = options.parent


  ###*
   * Submit NML Form via AJAX to server.
   * @return {Boolean} false, prevent page reload
  ###
  submit: ->

    form = @parent.ui.form[0]

    if form.checkValidity()

      Toast.info("Uploading NML", false)
      @parent.ui.submitButton.text("Uploading...")

      Request.sendMultipartFormReceiveJSON("/api/tasks",
        data : new FormData(form)
      )
      .then(
        => @fileuploadDone()
        -> console.log(arguments)
      )
      .then(
        =>
          @fileuploadAlways()
      )

    # prevent page reload
    return false


  ###*
   * Upload Success Hook.
   * Show success message and clear form.
  ###
  fileuploadDone: ->

    debugger
    @parent.showSaveSuccess()

    if @CLEAR_ON_SUCCESS
      @parent.clearForm()


  ###*
   * Upload Finish Hook.
   * Enable button and set button text.
  ###
  fileuploadAlways: ->

    @parent.ui.submitButton.prop("disabled", false)
    @parent.ui.submitButton.removeClass("disabled")
    @parent.ui.submitButton.text("Create")


module.exports = TaskCreateFromNMLView
