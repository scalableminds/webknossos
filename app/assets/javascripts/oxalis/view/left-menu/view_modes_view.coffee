### define
backbone.marionette : marionette
app : app
oxalis/constants : constants
###

class ViewModesView extends Backbone.Marionette.ItemView

  className : "col-sm-12"
  template : _.template("""
    <div class="btn-group btn-group-justified">
      <div class="btn-group">
        <button type="button" class="btn btn-default btn-primary" id="mode-3planes">3 Planes</button>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-default" id="mode-sphere">Sphere</button>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-default" id="mode-arbitraryplane">Arbitrary Plane</button>
      </div>
    </div>
  """)

  events :
    "click #mode-3planes" : "changeModeToPlanes"
    "click #mode-sphere" : "changeModeToSphere"
    "click #mode-arbitraryplane" : "changeModeToArbitrary"

  initialize : (options) ->


  changeModeToArbitrary : ->

    app.vent.trigger("changeViewMode", constants.MODE_ARBITRARY_PLANE)


  changeModeToSphere : ->

    app.vent.trigger("changeViewMode", constants.MODE_ARBITRARY)


  changeModeToPlanes : ->

    app.vent.trigger("changeViewMode", constants.MODE_PLANE_TRACING)

