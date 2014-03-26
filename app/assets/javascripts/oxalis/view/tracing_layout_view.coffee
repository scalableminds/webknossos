### define
backbone.marionette : marionette
app : app
./left_menu_view : LeftMenuView
./right_menu_view : RightMenuView
./tracing_view : TracingView
oxalis/controller : OxalisController
oxalis/model : OxalisModel
oxalis/constants : constants
###

class TracingLayoutView extends Backbone.Marionette.Layout

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
      "mode" : "skeleton"
      "controlMode" : constants.CONTROL_MODE_TRACE
      "_model" : oxalisModel = new OxalisModel()
      )


    @leftMenuView = new LeftMenuView(@options)
    @rightMenuView = new RightMenuView(@options)
    @tracingView = new TracingView(@options)


    @listenTo(@, "render", @afterRender)


  afterRender : ->

    @leftMenu.show(@leftMenuView)
    @rightMenu.show(@rightMenuView)
    @tracingContainer.show(@tracingView)

    app.oxalis = new OxalisController(@options)
    #@resize()


  resize : ->

    _.defer =>
      menuPosition = @ui.rightMenu.position()
      MARGIN = 40
      @ui.rightMenu
        .width(window.innerWidth - menuPosition.left - MARGIN)
        .height(window.innerHeight - menuPosition.top - MARGIN)
