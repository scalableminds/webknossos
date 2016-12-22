_          = require("lodash")
Marionette = require("backbone.marionette")
Constants  = require("oxalis/constants")

class VolumeActionsView extends Marionette.View

  template : _.template("""
    <div class="btn-group">
      <button
        type="button"
        class="btn btn-default <% if (isMoveMode) { %> btn-primary <% } %>"
        id="mode-move">
          Move
      </button>
      <button
        type="button"
        class="btn btn-default <% if (!isMoveMode) { %> btn-primary <% } %>"
        id="mode-trace">
          Trace
      </button>
    </div>
    <div class="btn-group">
      <button type="button" class="btn btn-default" id="create-cell">Create new cell (C)</button>
    </div>
  """)

  modeMapping :
    "mode-trace" : Constants.VOLUME_MODE_TRACE
    "mode-move" : Constants.VOLUME_MODE_MOVE

  events :
    "click [id^=mode]" : "changeMode"
    "click #create-cell" : "createCell"


  initialize : (options) ->

    @listenTo(@model.volumeTracing, "change:mode", @render)


  createCell : ->

    @model.volumeTracing.createCell()


  changeMode : (evt) ->

    mode = @modeMapping[evt.target.id]
    @model.volumeTracing.setMode(mode)


  serializeData : ->

    return {
      isMoveMode : @model.volumeTracing.mode == Constants.VOLUME_MODE_MOVE
    }


module.exports = VolumeActionsView
