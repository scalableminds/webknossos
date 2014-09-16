### define
backbone.marionette : marionette
###

class TracingView extends Backbone.Marionette.LayoutView

  id : "render"
  template : _.template("""
    <div id="help-modal" class="modal fade"></div>
    <div id="modal" class="modal fade"></div>
    <div id="inputcatchers">
      <div id="planexy" class="inputcatcher"></div>
      <div id="planeyz" class="inputcatcher"></div>
      <div id="planexz" class="inputcatcher"></div>
      <div id="TDView" class="inputcatcher">
        <div id="TDViewControls" class="btn-group">
          <button type="button" class="btn btn-default btn-sm">3D</button>
          <button type="button" class="btn btn-default btn-sm">
            <span></span>XY
          </button>
          <button type="button" class="btn btn-default btn-sm">
            <span></span>YZ
          </button>
          <button type="button" class="btn btn-default btn-sm">
            <span></span>XZ
          </button>
        </div>
      </div>
    </div>
  """)

  initialize : ->
