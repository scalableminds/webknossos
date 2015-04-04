### define
backbone.marionette : marionette
app : app
./action_bar_view : ActionBarView
./settings/tab_views/settings_tab_view : SettingsTabView
./settings/tab_views/skeleton_plane_tab_view : SkeletonPlaneTabView
./skeletontracing/skeletontracing_right_menu_view : SkeletonTracingRightMenuView
./volumetracing/volumetracing_right_menu_view : VolumeTracingRightMenuView
./tracing_view : TracingView
oxalis/controller : OxalisController
oxalis/model : OxalisModel
oxalis/constants : Constants
###

class TracingLayoutView extends Backbone.Marionette.LayoutView

  MARGIN : 40

  className : "text-nowrap"
  template : _.template("""
    <div id="action-bar"></div>
    <div id="settings-menu"></div>
    <div id="tracing"></div>
    <div id="right-menu"></div>
   """)

  ui :
    "rightMenu" : "#right-menu"

  regions :
    "actionBar" : "#action-bar"
    "rightMenu" : "#right-menu"
    "tracingContainer" : "#tracing"
    "settings" : "#settings-menu"


  initialize : (options) ->

    @options = _.extend(
      {},
      options,
      model : new OxalisModel(options)
    )

    @model = @options.model

    @listenTo(@, "render", @afterRender)
    @listenTo(app.vent, "planes:resize", @resize)
    @listenTo(@model, "sync", @renderRegions)
    $(window).on("resize", @resize.bind(@))

    app.oxalis = new OxalisController(@options)


  resize : ->

    if @isSkeletonMode()
      menuPosition = @ui.rightMenu.position()
      newWidth = window.innerWidth - menuPosition.left - @MARGIN
      if menuPosition.left < window.innerWidth and newWidth > 350
        @ui.rightMenu.width(newWidth)


  renderRegions : ->

    @render()

    actionBarView = new ActionBarView(@options)
    tracingView = new TracingView(@options)

    @actionBar.show(actionBarView, preventDestroy : true)
    @tracingContainer.show(tracingView, preventDestroy : true)

    if @isSkeletonMode()
      settingsTabView = new SkeletonPlaneTabView(@options)
      @rightMenuView = new SkeletonTracingRightMenuView(@options)
    else if @isVolumeMode()
      settingsTabView = new SettingsTabView(@options)
      @rightMenuView = new VolumeTracingRightMenuView(@options)

    @settings.show(settingsTabView, preventDestroy : true)
    @rightMenu.show(@rightMenuView)


  isTracingMode : ->

    return @model.get("controlMode") != Constants.CONTROL_MODE_VIEW


  isSkeletonMode : ->

    return @model.get("mode") == Constants.MODE_PLANE_TRACING && @isTracingMode()


  isVolumeMode : ->

    return @model.get("mode") == Constants.MODE_VOLUME && @isTracingMode()


  onDestroy : ->

    app.oxalis = null
