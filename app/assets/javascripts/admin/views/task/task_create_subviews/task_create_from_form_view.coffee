_                 = require("lodash")
Marionette        = require("backbone.marionette")
routes            = require("routes")
DatasetCollection = require("admin/models/dataset/dataset_collection")
SelectionView     = require("admin/views/selection_view")
Utils             = require("libs/utils")


class TaskCreateFromFormView extends Marionette.View

  id : "create-from-form"

  # clear all form inputs when task was successfully created
  CLEAR_ON_SUCCESS : true

  template : _.template("""
    <div class=" form-group">
      <label class="col-sm-2 control-label" for="dataSet">Dataset</label>
      <div class="col-sm-9 dataSet">
      </div>
    </div>

    <div class=" form-group">
      <label class="col-sm-2 control-label" for="editPosition">Start</label>
      <div class="col-sm-9">
        <input
          type="text"
          id="editPosition"
          name="editPosition"
          placeholder="x, y, z"
          title="x, y, z"
          pattern="(\\s*\\d+\\s*,){2}(\\s*\\d+\\s*)"
          value="<%- editPosition %>"
          required
          class="form-control">
      </div>
    </div>

    <div class=" form-group">
      <label class="col-sm-2 control-label" for="editRotation">Start Rotation</label>
      <div class="col-sm-9">
        <input
          type="text"
          id="editRotation"
          name="editRotation"
          placeholder="Rotation x, Rotation y, Rotation z"
          title="Rotation x, Rotation y, Rotation z"
          pattern="(\\s*\\d+\\s*,){2}(\\s*\\d+\\s*)"
          value="<%- editRotation %>"
          required
          class="form-control">
      </div>
    </div>
  """)

  regions :
    "dataSet" : ".dataSet"

  ui :
    "editPosition" : "#editPosition"
    "editRotation" : "#editRotation"

  initialize : (options) ->

    @parent = options.parent


  serializeForm : ->

    formValues = @parent.serializeForm()
    formValues.editPosition = Utils.stringToNumberArray(@ui.editPosition.val())
    formValues.editRotation = Utils.stringToNumberArray(@ui.editRotation.val())

    return formValues

  ###*
   * Submit Form via AJAX to server.
   * @return {Boolean} false, prevent page reload
  ###
  submit : ->

    serializedForm = @serializeForm()

    # unblock submit button after model synched
    # show a status flash message
    @model.save(serializedForm,
      params : {type : "default"}
      error : =>
        @parent.showSaveError()

      success : (task) =>
        @parent.showSaveSuccess(task)
    )

    # prevent page reload
    return false


  ###*
  * Render a dataset SelectionView.
  ###
  onRender : ->

    @dataSetSelectionView = new SelectionView(
      collection : new DatasetCollection()
      childViewOptions :
        modelValue : -> return "#{@model.get("name")}"
        defaultItem : {name : @model.get("dataSet")}
      data : "amIAnAdmin=true&isActive=true"
      name : "dataSet"
      parentModel : @model
    )

    @showChildView("dataSet", @dataSetSelectionView)

module.exports = TaskCreateFromFormView
