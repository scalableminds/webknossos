### define 
../view/abstract_tree_view : AbstractTreeView
###


class AbstractTreeController


  model : null
  view : null


  constructor : (@model) ->
    
    container = $("#abstractTreeViewer")
    @view = new AbstractTreeView(container.width(), container.height() - 20)
    container.append(@view.canvas)

    @bind()
    @drawTree(model.route.getTree())


  bind : ->

    { view } = @

    view.on
      nodeClick : (id) => @setActiveNode(id, true, false)

    @model.route.on({
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

    { view, model } = @

    # Use node with minimal ID as root
    for node in model.route.getTree().nodes
      if root?
        if root.id > node.id then root = node
      else 
        root = node

    view.drawTree(root, model.route.getActiveNodeId())


  setActiveNode : (nodeId, centered, mergeTree) ->
    
    { model } = @

    model.route.setActiveNode(nodeId, mergeTree)

    @centerActiveNode() if centered


  centerActiveNode : ->

    { model } = @

    position = model.route.getActiveNodePos()
    if position
      model.flycam.setPosition(position)