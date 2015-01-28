### define
underscore : _
backbone.marionette : marionette
routes : routes
admin/models/dataset/dataset_collection : DatasetCollection
admin/views/selection_view : SelectionView
###

class TaskCreateFromFormView extends Backbone.Marionette.LayoutView

  id : "create-from-form"
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
          value="0, 0, 0"
          required=true
          class="form-control">
        <span class="help-block errors"></span>
      </div>
    </div>

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
  """)

  regions:
    "dataSet" : ".dataSet"

  ui:
    "editPosition" : "#editPosition"
    "boundingBox" : "#boundingBox"

  ###*
   * Update the task model with inputs from form.
   *
   * @method updateModel
   ###
  updateModel : ->

    @model.set(
      # split string by comma delimiter, trim whitespace and cast to integer
      editPosition : _.map(@ui.editPosition.val().split(","), (number) ->
          parseInt( number.trim() )
        )
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

    # trigger selection view to update the model as well
    @dataSetSelectionView.updateModel()

  onRender: ->

    @dataSetSelectionView = new SelectionView(
      collection: new DatasetCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name: "dataSet"
      parentModel : @model
    )

    @dataSet.show(@dataSetSelectionView)
