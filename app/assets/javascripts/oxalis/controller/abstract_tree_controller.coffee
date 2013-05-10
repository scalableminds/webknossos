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
    @drawTree(model.route.getTree())


  bind : ->

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