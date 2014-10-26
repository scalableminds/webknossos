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
      <label class="col-sm-2 control-label" for="start_point">Start</label>
      <div class="col-sm-9">
        <input type="text" id="start_point" name="start.point" value="0, 0, 0" class="form-control">
        <span class="help-block errors"></span>
      </div>
    </div>

    <div class=" form-group">
      <label class="col-sm-2 control-label" for="boundingBox_box">Bounding Box</label>
      <div class="col-sm-9">
        <input type="text" id="boundingBox_box" name="boundingBox.box" value="0, 0, 0, 0, 0, 0" class="form-control">
        <span class="help-block errors"></span>
      </div>
    </div>
  """)

  regions:
    "dataSet" : ".dataSet"

  #events :
  # put submit event here

  onRender: ->

    dataSetSelectionView = new SelectionView(
      collection: new DatasetCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name: "dataSet"
    )

    @dataSet.show(dataSetSelectionView)

