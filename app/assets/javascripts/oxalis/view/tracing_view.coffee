Marionette = require("backbone.marionette")
Constants  = require("../constants")

class TracingView extends Marionette.View

  id : "render"
  template : _.template("""
    <div id="modal" class="modal fade" tabindex="-1" role="dialog"></div>
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

  events :
    "contextmenu" : "disableContextMenu"

  ui :
    "inputcatchers" : ".inputcatcher"

  initialize : ->

    @listenTo(@model.flycam, "zoomStepChanged", ->
      @$el.toggleClass("zoomstep-warning",
        @model.volumeTracing? and not @model.canDisplaySegmentationData())
    )


  disableContextMenu : (event) ->

    # hide contextmenu, while rightclicking a canvas
    event.preventDefault()
    return


  onRender : ->

    # Hide the input catchers arbitrary model
    if @model.get("mode") in Constants.MODES_ARBITRARY
      @ui.inputcatchers.hide()

module.exports = TracingView
