### define
backbone.marionette : marionette
app : app
./left_menu_view : LeftMenuView
./right_menu_view : RightMenuView
./tracing_view : TracingView
oxalis/controller : OxalisController
oxalis/model : OxalisModel
oxalis/Constants : Constants
###

class TracingLayoutView extends Backbone.Marionette.LayoutView

  MARGIN : 40

  template : _.template("""
    <div id="left-menu"></div>
    <div id="tracing"></div>
    <div id="right-menu"></div>
   """)

  ui :
    "rightMenu" : "#right-menu"

  regions :
    "leftMenu" : "#left-menu"
    "rightMenu" : "#right-menu"
    "tracingContainer" : "#tracing"


  initialize : (options) ->

    @options = _.extend(
      {},
      options,
      _model : new OxalisModel()
      )

    @listenTo(@, "render", @afterRender)
    @listenTo(app.vent, "planes:resize", @resize)
    @listenTo(app.vent, "model:sync", @renderRegions)
    #$(window).on("resize", @resize.bind(@))

    app.oxalis = new OxalisController(@options)


  resize : ->

    if @hasRightMenu
      menuPosition = @ui.rightMenu.position()
      newWidth = window.innerWidth - menuPosition.left - @MARGIN
      if newWidth > 350
        @ui.rightMenu.width(newWidth)


  renderRegions : ->

    @render()

    @leftMenuView = new LeftMenuView(@options)
    @tracingView = new TracingView(@options)

    @leftMenu.show(@leftMenuView, preventDestroy : true)
    @tracingContainer.show(@tracingView, preventDestroy : true)

    isTracingMode = @options.controlMode != Constants.CONTROL_MODE_VIEW
    isSkeletonMode = @options._model.mode == Constants.MODE_PLANE_TRACING

    if isTracingMode and isSkeletonMode
      @rightMenuView = new RightMenuView(@options)
      @rightMenu.show(@rightMenuView)


