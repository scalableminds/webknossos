### define
backbone.marionette : marionette
app : app
oxalis/constants : constants
###

class ViewModesView extends Backbone.Marionette.ItemView

  className : "col-sm-12"
  template : _.template("""
    <div class="btn-group btn-group-justified" id="mode-container">
      <div class="btn-group">
        <button type="button" class="btn btn-default" id="mode-3planes">3 Planes</button>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-default" id="mode-sphere">Sphere</button>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-default" id="mode-arbitraryplane">Arbitrary Plane</button>
      </div>
    </div>
  """)

  modeMapping :
    "mode-3planes" : constants.MODE_PLANE_TRACING
    "mode-sphere" : constants.MODE_ARBITRARY
    "mode-arbitraryplane" : constants.MODE_ARBITRARY_PLANE

  events :
    "click #mode-3planes" : "changeMode"
    "click #mode-sphere" : "changeMode"
    "click #mode-arbitraryplane" : "changeMode"


  initialize : (options) ->

    @listenTo(app.vent, "changeViewMode", @updateForMode)


  changeMode : (evt) ->

    mode = @modeMapping[evt.target.id]
    app.vent.trigger("changeViewMode", mode)


  updateForMode : (mode) ->

    for buttonId in _.keys(@modeMapping)
      @$("##{buttonId}").removeClass("btn-primary")

    buttonId = _.invert(@modeMapping)[mode]
    @$("##{buttonId}").addClass("btn-primary")

