### define
underscore : _
app : app
oxalis/view/skeletontracing/abstract_tree_renderer : AbstractTreeRenderer
###


class AbstractTreeView extends Backbone.Marionette.ItemView

  template : _.template("""
      <canvas id="abstract-tree-canvas">
    """)

  ui :
    "canvas" : "canvas"

  events:
    "click @ui.canvas" : "handleClick"

  initialize : ->

    @listenTo(app.vent, "planes:resize", @resize)
    @listenTo(app.vent, "view:setTheme", @drawTree)

    @listenTo(@model.skeletonTracing, "newActiveNode" , @drawTree)
    @listenTo(@model.skeletonTracing, "newActiveTree" , @drawTree)
    @listenTo(@model.skeletonTracing, "newTree" , @drawTree)
    @listenTo(@model.skeletonTracing, "mergeTree" , @drawTree)
    @listenTo(@model.skeletonTracing, "reloadTrees" , @drawTree)
    @listenTo(@model.skeletonTracing, "deleteTree" , @drawTree)
    @listenTo(@model.skeletonTracing, "deleteActiveNode" , @drawTree)
    @listenTo(@model.skeletonTracing, "newNode" , @drawTree)

    @initialized = false
    $(window).on("resize", => @drawTree())

    @drawTree()


  resize : ->

    @initialized = true
    @render()


  render : ->

    super()
    if @initialized
      @abstractTreeRenderer = new AbstractTreeRenderer(@ui.canvas)
    @drawTree()


  drawTree : ->

    if @model.skeletonTracing and @abstractTreeRenderer
      @abstractTreeRenderer.drawTree(@model.skeletonTracing.getTree(), @model.skeletonTracing.getActiveNodeId())


  handleClick : (event) ->

    id = @abstractTreeRenderer.getIdFromPos(event.offsetX, event.offsetY)
    if id
      @model.skeletonTracing.trigger("newActiveNode", id)
