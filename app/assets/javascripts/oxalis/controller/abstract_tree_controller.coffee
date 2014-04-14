### define
../view/skeletontracing/abstract_tree_view : AbstractTreeView
###


class AbstractTreeController


  model : null
  view : null


  constructor : (@model) ->

    @view = new AbstractTreeView()

    @bind()
    @drawTree(model.skeletonTracing.getTree())


  bind : ->

    @model.skeletonTracing.on({
      newActiveNode        : => @drawTree(),
      newActiveTree        : => @drawTree(),
      newTree              : => @drawTree(),
      mergeTree            : => @drawTree(),
      reloadTrees          : => @drawTree(),
      deleteTree           : => @drawTree(),
      deleteActiveNode     : => @drawTree(),
      newNode              : => @drawTree()
      })


  setDimensions : ->
    @view.setDimensions(arguments...)
    @drawTree()


  drawTree : ->

    @view.drawTree(@model.skeletonTracing.getTree(), @model.skeletonTracing.getActiveNodeId())


  setActiveNode : (nodeId, centered, mergeTree) ->

    { model } = @

    model.skeletonTracing.setActiveNode(nodeId, mergeTree)

    @centerActiveNode() if centered


  centerActiveNode : ->

    { model } = @

    position = model.skeletonTracing.getActiveNodePos()
    if position
      model.flycam.setPosition(position)
