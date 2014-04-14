### define
app : app
oxalis/view/skeletontracing/abstract_tree_renderer : AbstractTreeRenderer
###


class AbstractTreeView extends Backbone.Marionette.ItemView

  template : _.template("""
      <canvas width="<%= width %>" height="<%= height %>" style="width: <%= width %>px; height: <%= height %>px">
    """)

  ui :
    "canvas" : "canvas"

  events:
    "click @ui.canvas" : "handleClick"

  initialize : (options) ->

    {@_model} = options

    @listenTo(app.vent, "view:setTheme", @drawTree)
    @listenTo(@, "show", ->

      @width = @$el.width()
      @height = @$el.height()
      @view = new AbstractTreeRenderer(
        @ui.canvas,
        @width,
        @height
      )

      #re-render with correct height/width
      @render()
    )

    @listenTo(app.vent, "model:sync", ->

      @listenTo(@_model.skeletonTracing, "newActiveNode" , @drawTree)
      @listenTo(@_model.skeletonTracing, "newActiveTree" , @drawTree)
      @listenTo(@_model.skeletonTracing, "newTree" , @drawTree)
      @listenTo(@_model.skeletonTracing, "mergeTree" , @drawTree)
      @listenTo(@_model.skeletonTracing, "reloadTrees" , @drawTree)
      @listenTo(@_model.skeletonTracing, "deleteTree" , @drawTree)
      @listenTo(@_model.skeletonTracing, "deleteActiveNode" , @drawTree)
      @listenTo(@_model.skeletonTracing, "newNode" , @drawTree)

      @drawTree(@_model.skeletonTracing.getTree())
    )

  drawTree : ->

    @view.drawTree(@_model.skeletonTracing.getTree(), @_model.skeletonTracing.getActiveNodeId())


  serializeData : ->

    return {
      width : @width || 300
      height : @height || 300
    }


  handleClick : (event) ->

    id = @getIdFromPos(evt.offsetX, evt.offsetY)
    if id
      app.vent.trigger("activeNode:change", id)
