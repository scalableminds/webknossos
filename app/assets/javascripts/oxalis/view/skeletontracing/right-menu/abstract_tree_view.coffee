### define
underscore : _
app : app
oxalis/view/skeletontracing/abstract_tree_renderer : AbstractTreeRenderer
###


class AbstractTreeView extends Backbone.Marionette.ItemView

  className : "flex-column"
  template : _.template("""
      <canvas width="<%= width %>" height="<%= height %>" style="width: <%= width %>px; height: <%= height %>px">
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


  resize : ->

    @width = @$el.width()
    @height = @$el.height() - 10

    #re-render with correct height/width
    @render()

    @abstractTreeRenderer = new AbstractTreeRenderer(
      @ui.canvas,
      @width,
      @height
    )

    @drawTree()


  drawTree : ->

    if @model.skeletonTracing and @abstractTreeRenderer
      @abstractTreeRenderer.renderComments(@model.user.get("renderComments"))
      @abstractTreeRenderer.drawTree(
        @model.skeletonTracing.getTree(),
        @model.skeletonTracing.getActiveNodeId(),
        @model.skeletonTracing.comments)


  serializeData : ->

    return {
      width : @width || 300
      height : @height || 300
    }


  handleClick : (event) ->

    id = @abstractTreeRenderer.getIdFromPos(event.offsetX, event.offsetY)
    if id
      @model.skeletonTracing.trigger("newActiveNode", id)
      @model.skeletonTracing.centerActiveNode()
