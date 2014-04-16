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

  MARGIN : 40

  template : _.template("""
    <div id="left-menu"></div>
    <div id="tracing"></div>

    <% if (!isViewMode()) { %>
      <div id="right-menu"></div>
    <% } %>
   """)

  ui :
    "rightMenu" : "#right-menu"

  regions :
    "leftMenu" : "#left-menu"
    "rightMenu" : "#right-menu"
    "tracingContainer" : "#tracing"

  templateHelpers : ->
    isViewMode : ->
      return @controleMode == constants.CONTROL_MODE_VIEW


  initialize : (options) ->

    @options = _.extend(
      {},
      options,
      _model : new OxalisModel()
      )

    @leftMenuView = new LeftMenuView(@options)
    @tracingView = new TracingView(@options)

    if @options.controlMode != constants.CONTROL_MODE_VIEW
      @rightMenuView = new RightMenuView(@options)


    @listenTo(@, "render", @afterRender)
    @listenTo(app.vent, "planes:resize", @resize)


  resize : ->

    menuPosition = @ui.rightMenu.position()
    @ui.rightMenu.width(window.innerWidth - menuPosition.left - @MARGIN)


  afterRender : ->

    @leftMenu.show(@leftMenuView)
    @tracingContainer.show(@tracingView)

    if @rightMenuView
      @rightMenu.show(@rightMenuView)

    app.oxalis = new OxalisController(@options)


  serializeData : ->

    return @options



