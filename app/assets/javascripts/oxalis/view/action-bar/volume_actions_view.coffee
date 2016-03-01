_          = require("lodash")
Marionette = require("backbone.marionette")
Constants  = require("oxalis/constants")

class VolumeActionsView extends Marionette.ItemView

  template : _.template("""
    <div class="btn-group">
      <button type="button" class="btn btn-default btn-primary" id="mode-move">Move</button>
      <button type="button" class="btn btn-default" id="mode-trace">Trace</button>
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

    @listenTo(app.vent, "changeVolumeMode", @updateForMode)


  createCell : ->

    @model.volumeTracing.createCell()


  changeMode : (evt) ->

    mode = @modeMapping[evt.target.id]
    app.vent.trigger("changeVolumeMode", mode)


  updateForMode : (mode) ->

    @$("button").removeClass("btn-primary")

    buttonId = _.invert(@modeMapping)[mode]
    @$("##{buttonId}").addClass("btn-primary")

module.exports = VolumeActionsView
