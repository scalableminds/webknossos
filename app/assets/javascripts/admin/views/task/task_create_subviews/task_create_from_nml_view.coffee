### define
underscore : _
backbone.marionette : marionette
routes : routes
###

class TaskCreateFromNMLView extends Backbone.Marionette.LayoutView

  id : "create-from-nml"
  template : _.template("""
  <div class=" form-group">
      <label class="col-sm-2 control-label" for="boundingBox">Bounding Box</label>
      <div class="col-sm-9">
        <span class="help-block hints"></span>
        <input
          type="text"
          id="boundingBox"
          name="boundingBox"
          placeholder="topLeft.x, topLeft.y, topLeft.z, width, height, depth"
          pattern="(\\s*\\d+\\s*,){5}(\\s*\\d+\\s*)"
          title="topLeft.x, topLeft.y, topLeft.z, width, height, depth"
          value="0, 0, 0, 0, 0, 0"
          required=true
          class="form-control">
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


  ui :
    # .file-info shows names of selected files
    "fileInfo" : ".file-info"

  ###*
   * Update the task model with inputs from NML form.
   *
   * @method updateModel
   ###
  updateModel : ->

    @model.set(
      # split string by comma delimiter, trim whitespace and cast to integer
      boundingBox : do =>
        intArray = _.map(@ui.boundingBox.val().split(","), (number) ->
          parseInt( number.trim() )
        )

        # user input could be too short
        # insert a 0 instead
        return {
          topLeft: [
            intArray[0] || 0,
            intArray[1] || 0,
            intArray[2] || 0
          ],
          width: intArray[3] || 0,
          height: intArray[4] || 0,
          depth: intArray[5] || 0
        }
    )

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
