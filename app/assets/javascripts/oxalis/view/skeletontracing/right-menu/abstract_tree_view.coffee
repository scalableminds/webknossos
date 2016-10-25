_                    = require("lodash")
app                  = require("app")
Marionette           = require("backbone.marionette")
AbstractTreeRenderer = require("oxalis/view/skeletontracing/abstract_tree_renderer")


class AbstractTreeView extends Marionette.View

  className : "flex-column"
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
    @listenTo(@model.user, "change:renderComments", @drawTree)

    @listenTo(@model.skeletonTracing, "newActiveNode" , @drawTree)
    @listenTo(@model.skeletonTracing, "newActiveTree" , @drawTree)
    @listenTo(@model.skeletonTracing, "newTree" , @drawTree)
    @listenTo(@model.skeletonTracing, "mergeTree" , @drawTree)
    @listenTo(@model.skeletonTracing, "reloadTrees" , @drawTree)
    @listenTo(@model.skeletonTracing, "deleteTree" , @drawTree)
    @listenTo(@model.skeletonTracing, "deleteActiveNode" , @drawTree)
    @listenTo(@model.skeletonTracing, "newNode" , @drawTree)
    @listenTo(@model.skeletonTracing, "updateComments" , @drawTree)

    @initialized = false
    $(window).on("resize", => @drawTree())


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
      @abstractTreeRenderer.renderComments(@model.user.get("renderComments"))
      @abstractTreeRenderer.drawTree(
        @model.skeletonTracing.getTree(),
        @model.skeletonTracing.getActiveNodeId())


  handleClick : (event) ->

    id = @abstractTreeRenderer.getIdFromPos(event.offsetX, event.offsetY)
    if id
      @model.skeletonTracing.setActiveNode(id)
      @model.skeletonTracing.centerActiveNode()


module.exports = AbstractTreeView
