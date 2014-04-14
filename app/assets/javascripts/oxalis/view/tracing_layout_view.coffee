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
    @listenTo(@rightMenu, "show", @resize)


  afterRender : ->

    @leftMenu.show(@leftMenuView)
    @tracingContainer.show(@tracingView)

    if @rightMenuView
      @rightMenu.show(@rightMenuView)

    app.oxalis = new OxalisController(@options)


  serializeData : ->

    return @options


  resize : ->

    _.defer =>
      menuPosition = @ui.rightMenu.position()
      MARGIN = 40
      @ui.rightMenu
        .height(window.innerHeight - menuPosition.top - MARGIN)
        #.width(window.innerWidth - menuPosition.left - MARGIN)
