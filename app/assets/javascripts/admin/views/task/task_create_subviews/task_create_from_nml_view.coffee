### define
underscore : _
backbone.marionette : marionette
routes : routes
###

class TaskCreateFromNMLView extends Backbone.Marionette.LayoutView

  id: "create-from-nml"

  <div class="form-group">
    <label class="col-sm-2 control-label" for="nmlFile">Reference NML File</label>
    <div class="col-sm-9">
      <div class="input-group">
        <span class="input-group-btn">
          <span class="btn btn-primary btn-file">
            Browse…
          <input type="file" multiple="" name="nmlFile" title="Please select at least one .nml file" required=true>
          </span>
        </span>
        <input type="text" class="file-info form-control" readonly="" required="">
      </div>
    </div>
  </div>

  """)

  events :
    # track file picker changes
    "change input[name=nmlFile]" : "updateFilenames"
  initialize: (options) ->

    @parent = options.parent

  ###*
   * Submit NML Form via AJAX to server.
   * @return {Boolean} false, prevent page reload
  ###
  submit: ->

    # prevent page reload
    return false


  ui :
    # .file-info shows names of selected files
    "fileInfo" : ".file-info"

  ###*

  ###*
   * Event handler which updates ui so user can see filenames he selected
   *
   * @method updateFilenames
   ###
  updateFilenames : (evt) ->

    # grab file list from event
    files = evt.target.files

    # build list
    filePath = _.pluck(files, "name").join(", ")

    # update ui
    @ui.fileInfo.val(filePath)
