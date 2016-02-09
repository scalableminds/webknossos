_             = require("lodash")
Marionette    = require("backbone.marionette")
routes        = require("routes")
Toast         = require("libs/toast")
Request       = require("libs/request")

class TaskCreateFromNMLView extends Marionette.LayoutView

  id: "create-from-nml"

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
            <input type="file" accept=".nml" name="nmlFile" title="Please select at least one .nml file" required=true>
          </span>
          <a href="#" class="input-group-addon btn btn-default fileinput-exists" data-dismiss="fileinput">Remove</a>
        </div>
      </div>
    </div>
  """)

  ui :
    "fileUpload" : "[type=file]"

  initialize : (options) ->

    @parent = options.parent


  ###*
   * Submit NML Form via AJAX to server.
   * @return {Boolean} false, prevent page reload
  ###
  submit : ->

    serializedForm = @parent.serializeForm()
    @model.set(serializedForm)

    payload = new FormData()
    payload.append("formJSON", JSON.stringify(serializedForm))
    payload.append("nmlFile", @ui.fileUpload[0].files[0])

    form = @parent.ui.form[0]

    if form.checkValidity()

      Toast.info("Uploading NML", false)
      @parent.ui.submitButton.text("Uploading...")

      Request.sendMultipartFormReceiveJSON("/api/tasks",
        data : payload
        params : {type : "nml"}
      )
      .then(
        =>
          @parent.showSaveSuccess()

          # Jasny Bootstrap's `reset` is broken (stack overflow)
          # https://github.com/jasny/bootstrap/issues/179)
          # if @CLEAR_ON_SUCCESS
          #   @parent.clearForm()

        (obj) -> console.error(obj.errors)
      )
      .then(
        =>
          @fileuploadAlways()
      )

    # prevent page reload
    return false


  ###*
   * Upload Finish Hook.
   * Enable button and set button text.
  ###
  fileuploadAlways : ->

    @parent.ui.submitButton.prop("disabled", false)
    @parent.ui.submitButton.removeClass("disabled")
    @parent.ui.submitButton.text("Create")


module.exports = TaskCreateFromNMLView
