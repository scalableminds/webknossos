Marionette = require("backbone.marionette")
app        = require("app")
constants  = require("oxalis/constants")

class ViewModesView extends Marionette.View

  template : _.template("""
    <div class="btn-group btn-group">
      <div class="btn-group">
        <button type="button" class="btn btn-default" id="mode-3planes">Orthogonal</button>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-default" id="mode-sphere">Flight</button>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-default" id="mode-arbitraryplane">Oblique</button>
      </div>
    </div>
  """)

  modeMapping :
    "mode-3planes" : constants.MODE_PLANE_TRACING
    "mode-sphere" : constants.MODE_ARBITRARY
    "mode-arbitraryplane" : constants.MODE_ARBITRARY_PLANE

  events :
    "click button" : "changeMode"


  initialize : (options) ->

    @listenTo(@model, "change:mode", @updateForMode)
    @listenTo(this, "attach", @afterAttach)


  afterAttach : ->
    for mode, modeValue of @modeMapping
      $("##{mode}").attr("disabled", modeValue not in @model.get("allowedModes"))

    @updateForMode(@model.get("mode"))
    return


  changeMode : (evt) ->

    evt.target.blur()
    mode = @modeMapping[evt.target.id]
    @model.setMode(mode)


  updateForMode : (mode) ->

    @$("button").removeClass("btn-primary")

    buttonId = _.invert(@modeMapping)[mode]
    @$("##{buttonId}").addClass("btn-primary")

module.exports = ViewModesView
