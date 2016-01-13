_                 = require("lodash")
Marionette        = require("backbone.marionette")
routes            = require("routes")
DatasetCollection = require("admin/models/dataset/dataset_collection")
SelectionView     = require("admin/views/selection_view")


class TaskCreateFromFormView extends Marionette.LayoutView

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
          value="0, 0, 0"
          required=true
          class="form-control">
        <span class="help-block errors"></span>
      </div>
    </div>
  """)

  regions:
    "dataSet": ".dataSet"

  ui:
    "editPosition": "#editPosition"

  initialize: (options) ->

    @parent = options.parent


  ###*
   * Update the model with form data.
   ###
  updateModel : ->

    @model.set(
      # split string by comma delimiter, trim whitespace and cast to integer
      editPosition : _.map(@ui.editPosition.val().split(","), (number) ->
          parseInt( number.trim() )
        )
    )

    # trigger selection view to update the model as well
    @dataSetSelectionView.updateModel()


  ###*
   * Submit Form via AJAX to server.
   * @return {Boolean} false, prevent page reload
  ###
  submit: ->

    # unblock submit button after model synched
    # show a status flash message
    @model.save({},
      error : =>
        @parent.ui.submitButton.prop("disabled", false)
        @parent.ui.submitButton.removeClass("disabled")

        @parent.showSaveError()

      success : =>
        @parent.ui.submitButton.prop("disabled", false)
        @parent.ui.submitButton.removeClass("disabled")

        if @CLEAR_ON_SUCCESS
          @clearForm()
          @parent.clearForm()

        @parent.showSaveSuccess()
    )

    # prevent page reload
    return false


  ###*
   * Clear all text inputs in the form.
  ###
  clearForm: ->

      @ui.editPosition.val("0, 0, 0")


  ###*
  * Render a dataset SelectionView.
  ###
  onRender: ->

    @dataSetSelectionView = new SelectionView(
      collection: new DatasetCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true&isActive=true"
      name: "dataSet"
      parentModel : @model
    )

    @dataSet.show(@dataSetSelectionView)

module.exports = TaskCreateFromFormView
