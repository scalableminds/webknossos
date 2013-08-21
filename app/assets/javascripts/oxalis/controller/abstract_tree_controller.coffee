### define 
../view/abstract_tree_view : AbstractTreeView
###


class AbstractTreeController


  model : null
  view : null


  constructor : (@model) ->
    
    container = $("#abstractTreeViewer")
    @view = new AbstractTreeView(container.width(), container.height())
    container.append(@view.canvas)

    @bind()
    @drawTree(model.cellTracing.getTree())


  bind : ->

    @model.cellTracing.on({
      newActiveNode        : => @drawTree(),
      newActiveTree        : => @drawTree(),
      newTree              : => @drawTree(),
      mergeTree            : => @drawTree(),
      reloadTrees          : => @drawTree(),
      deleteTree           : => @drawTree(),
      deleteActiveNode     : => @drawTree(),
      newNode              : => @drawTree()
      })


  drawTree : ->
    
    @view.drawTree(@model.cellTracing.getTree(), @model.cellTracing.getActiveNodeId())


  setActiveNode : (nodeId, centered, mergeTree) ->
    
    { model } = @

    model.cellTracing.setActiveNode(nodeId, mergeTree)

    @centerActiveNode() if centered


  centerActiveNode : ->

    { model } = @

    position = model.cellTracing.getActiveNodePos()
    if position
      model.flycam.setPosition(position)