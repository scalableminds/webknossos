### define
underscore : _
backbone.marionette : marionette
routes : routes
###

class TaskCreateFromNMLView extends Backbone.Marionette.LayoutView

  id : "create-from-nml"
  template : _.template("""
  <div class=" form-group">
    <label class="col-sm-2 control-label" for="boundingBox_box">Bounding Box</label>
    <div class="col-sm-9">
      <input type="text" id="boundingBox_box" name="boundingBox.box" value="0, 0, 0, 0, 0, 0" class="form-control">
      <span class="help-block errors"></span>
    </div>
  </div>

  <div class="form-group">
    <label class="col-sm-2 control-label" for="nmlFile">Reference NML File</label>
    <div class="col-sm-9">
      <div class="input-group">
        <span class="input-group-btn">
          <span class="btn btn-primary btn-file">
            Browse…
          <input type="file" multiple="" name="nmlFile">
          </span>
        </span>
        <input type="text" class="file-info form-control" readonly="">
      </div>
    </div>
  </div>

  """)

  events :
    # track file picker changes
    "change input[name=nmlFile]" : "updateFilenames"


  ui :
    # .file-info shows names of selected files
    "fileInfo" : ".file-info"

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
