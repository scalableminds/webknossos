marionette                   = require("backbone.marionette")
app                          = require("app")
ActionBarView                = require("./action_bar_view")
SkeletonPlaneTabView         = require("./settings/tab_views/skeleton_plane_tab_view")
SkeletonArbitraryTabView     = require("./settings/tab_views/skeleton_arbitrary_tab_view")
VolumeTabView                = require("./settings/tab_views/volume_tab_view")
ViewmodeTabView              = require("./settings/tab_views/viewmode_tab_view")
SkeletonTracingRightMenuView = require("./skeletontracing/skeletontracing_right_menu_view")
VolumeTracingRightMenuView   = require("./volumetracing/volumetracing_right_menu_view")
ViewmodeRightMenuView        = require("./viewmode/viewmode_right_menu_view")
TracingView                  = require("./tracing_view")
OxalisController             = require("oxalis/controller")
OxalisModel                  = require("oxalis/model")
Constants                    = require("oxalis/constants")
offcanvas                    = require("offcanvas")

class TracingLayoutView extends Backbone.Marionette.LayoutView

  MARGIN : 40

  className : "text-nowrap"

  traceTemplate : _.template("""
    <div id="action-bar"></div>
    <div id="sliding-canvas">
      <div id="settings-menu-wrapper" class="navmenu-fixed-left offcanvas">
        <div id="settings-menu"></div>
      </div>
      <div id="tracing"></div>
      <div id="right-menu"></div>
    </div>
   """)

  viewTemplate : _.template("""
    <div id="action-bar"></div>
    <div id="settings-menu"></div>
    <div id="tracing"></div>
    <div id="right-menu"></div>
  """)

  getTemplate : ->
    if @isTracingMode()
      @traceTemplate
    else
      @viewTemplate

  ui :
    "rightMenu" : "#right-menu"
    "slidingCanvas" : "#sliding-canvas"

  regions :
    "actionBar" : "#action-bar"
    "rightMenu" : "#right-menu"
    "tracingContainer" : "#tracing"
    "settings" : "#settings-menu"

  events:
    "hidden.bs.offcanvas #settings-menu-wrapper" : "doneSliding"
    "shown.bs.offcanvas #settings-menu-wrapper" : "doneSliding"


  initialize : (options) ->

    @options = _.extend(
      {},
      options,
      model : new OxalisModel(options)
    )

    @model = @options.model

    @listenTo(@, "render", @afterRender)
    @listenTo(app.vent, "planes:resize", @resizeRightMenu)
    @listenTo(@model, "change:mode", @renderSettings)
    @listenTo(@model, "sync", @renderRegions)
    $(window).on("resize", @resizeRightMenu.bind(@))

    app.oxalis = new OxalisController(@options)


  doneSliding : (evt) ->

    @resizeRightMenu()


  resizeRightMenu : ->

    if @isSkeletonMode()

      menuPosition = @ui.rightMenu.position()
      slidingCanvasOffset = @ui.slidingCanvas.position().left

      newWidth = window.innerWidth - menuPosition.left - slidingCanvasOffset - @MARGIN

      if menuPosition.left < window.innerWidth and newWidth > 350
        @ui.rightMenu.width(newWidth)


  renderRegions : ->

    @render()

    actionBarView = new ActionBarView(@options)
    tracingView = new TracingView(@options)

    @actionBar.show(actionBarView, preventDestroy : true)
    @tracingContainer.show(tracingView, preventDestroy : true)

    if @isSkeletonMode()
      @rightMenuView = new SkeletonTracingRightMenuView(@options)
    else if @isVolumeMode()
      @rightMenuView = new VolumeTracingRightMenuView(@options)
    else
      @rightMenuView = new ViewmodeRightMenuView(@options)

    @rightMenu.show(@rightMenuView)
    @renderSettings()


  renderSettings : ->

    if @isSkeletonMode()
      settingsTabClass = if @isArbitraryMode() then SkeletonArbitraryTabView else SkeletonPlaneTabView
      settingsTabView = new settingsTabClass(@options)
    else if @isVolumeMode()
      settingsTabView = new VolumeTabView(@options)
    else
      settingsTabView = new ViewmodeTabView(@options)

    @settings.show(settingsTabView, preventDestroy : true)


  isTracingMode : ->

    return @model.get("controlMode") != Constants.CONTROL_MODE_VIEW


  isSkeletonMode : ->

    return @model.get("mode") in Constants.MODES_SKELETON && @isTracingMode()


  isVolumeMode : ->

    return @model.get("mode") == Constants.MODE_VOLUME && @isTracingMode()


  isArbitraryMode : ->

    return @model.get("mode") in Constants.MODES_ARBITRARY


  onDestroy : ->

    app.oxalis = null

module.exports = TracingLayoutView
