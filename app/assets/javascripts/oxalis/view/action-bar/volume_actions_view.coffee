_          = require("underscore")
marionette = require("backbone.marionette")
Constants  = require("oxalis/constants")

class VolumeActionsView extends Backbone.Marionette.ItemView

  template : _.template("""
    <div class="btn-group">
      <button type="button" class="btn btn-default btn-primary" id="mode-move">Move</button>
      <button type="button" class="btn btn-default" id="mode-trace">Trace</button>
    </div>
  """)

  modeMapping :
    "mode-trace" : Constants.VOLUME_MODE_TRACE
    "mode-move" : Constants.VOLUME_MODE_MOVE

  events :
    "click button" : "changeMode"


  initialize : (options) ->

    @listenTo(app.vent, "changeVolumeMode", @updateForMode)


  changeMode : (evt) ->

    mode = @modeMapping[evt.target.id]
    app.vent.trigger("changeVolumeMode", mode)


  updateForMode : (mode) ->

    @$("button").removeClass("btn-primary")

    buttonId = _.invert(@modeMapping)[mode]
    @$("##{buttonId}").addClass("btn-primary")

module.exports = VolumeActionsView
