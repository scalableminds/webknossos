### define
underscore : _
backbone.marionette : marionette
routes : routes
fileupload : Fileupload
###

class TaskCreateFromNMLView extends Backbone.Marionette.LayoutView

  id: "create-from-nml"
  API_URL: "/api/tasks-nml"

  # clear all form inputs when task was successfully created
  CLEAR_ON_SUCCESS : true

  template: _.template("""

  <div class="form-group">
    <label class="col-sm-2 control-label" for="nmlFile">Reference NML File</label>
    <div class="col-sm-9">
      <div class="input-group">
        <span class="input-group-btn">
          <span class="btn btn-primary btn-file">
            Browse…
          <input id="files" type="file" multiple="" name="nmlFiles[]" title="Please select at least one .nml file" required=true>
          </span>
        </span>
        <input type="text" class="file-info form-control" readonly="" required="">
      </div>
    </div>
  </div>

  """)

  events:
    "change #files": "updateFilenames" # track file picker changes

  ui:
    "fileInfo": ".file-info" # shows names of selected files
    "files": "#files" # actual file input

  initialize: (options) ->

    @parent = options.parent

    # setup upload utility
    @parent.ui.form.fileupload({
      url: @API_URL
      dataType: "json"
      type: "POST"
      multipart: true # enable multiple file uploads -- do we need this?
      singleFileUploads: false # put all files into 1 xhr
      autoUpload: false # upload on submit
      start: => @fileuploadStart()
      done: => @fileuploadDone()
      fail: => @parent.showSaveError()
      always: => @fileuploadAlways()
    })


  ###*
   * Submit NML Form via AJAX to server.
   * @return {Boolean} false, prevent page reload
  ###
  submit: ->

    # send files and remaining form data to server
    @parent.ui.form.fileupload("send", {
      files: @ui.files[0].files
      formData: @model.attributes
    })

    # prevent page reload
    return false


  ###*
   * Upload Start Hook.
   * Change button text, so user know upload is going.
  ###
  fileuploadStart: ->

    @parent.ui.submitButton.text("Uploading...")


  ###*
   * Upload Success Hook.
   * Show success message and clear form.
  ###
  fileuploadDone: ->
    @parent.showSaveSuccess()

    if @CLEAR_ON_SUCCESS
      @clearForm()
      @parent.clearForm()


  ###*
   * Upload Finish Hook.
   * Enable button and set button text.
  ###
  fileuploadAlways: ->

    @parent.ui.submitButton.prop("disabled", false)
    @parent.ui.submitButton.removeClass("disabled")
    @parent.ui.submitButton.text("Create")


  ###*
   * Clear all text inputs in the form.
  ###
  clearForm: ->

    @ui.files.val("")


  ###*
   * Event handler which updates ui so user can see selected filenames.
   ###
  updateFilenames: (evt) ->

    # grab file list from event
    files = evt.target.files

    # build list
    filePath = _.pluck(files, "name").join(", ")

    # update ui
    @ui.fileInfo.val(filePath)
