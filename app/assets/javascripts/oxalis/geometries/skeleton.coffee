### define
../model : Model
../model/celltracing : CellTracing
../model/dimensions : Dimensions
../../libs/event_mixin : EventMixin
../../libs/resizable_buffer : ResizableBuffer
../constants : constants
./tree : Tree
###

class Skeleton

  # This class is supposed to collect all the Geometries that belong to the skeleton, like
  # nodes, edges and trees

  COLOR_ACTIVE : 0xff0000
  
  constructor : (@flycam, @model) ->

    _.extend(this, new EventMixin())

    @cellTracing    = @model.cellTracing
    @treeGeometries = []

    @showInactiveTrees = true
    
    @reset()

    @cellTracing.on
      newActiveNode : => 
        @setActiveNode()
        @setInactiveTreeVisibility(@showInactiveTrees)
      newTree : (treeId, treeColor) => 
        @createNewTree(treeId, treeColor)
        @setInactiveTreeVisibility(@showInactiveTrees)
      deleteTree : (index) => @deleteTree(index)
      deleteActiveNode : (node, treeId) => @deleteNode(node, treeId)
      mergeTree : (lastTreeID, lastNode, activeNode) => 
        @mergeTree(lastTreeID, lastNode, activeNode)
      newNode : (centered) => @setWaypoint(centered)
      setBranch : (isBranchPoint, node) => 
        @setBranch(isBranchPoint, node)
      reloadTrees : (trees, finishedDeferred) =>
        @cellTracing.one("finishedRender", =>
          @cellTracing.one("finishedRender", =>
            @loadSkeletonFromModel(trees, finishedDeferred))
          @flycam.update())
        @flycam.update()
      newActiveTreeColor : (oldTreeId) => @updateActiveTreeColor(oldTreeId)

    @model.user.on "particleSizeChanged", (particleSize) =>
      @setParticleSize(particleSize)


  createNewTree : (treeId, treeColor) ->
    
    @treeGeometries.push( tree = new Tree(treeId, treeColor, @model) )
    @setActiveNode()
    @trigger "newGeometries", tree.getMeshes()


  # Will completely reload the trees from model.
  # This needs to be done at initialization

  reset : ->

    for tree in @treeGeometries
      @trigger "removeGeometries", tree.getMeshes()
      tree.dispose()

    @treeGeometries = []

    for tree in @cellTracing.getTrees()
      @createNewTree(tree.treeId, tree.color)

    @cellTracing.one("finishedRender", =>
      @cellTracing.one("finishedRender", =>
        @loadSkeletonFromModel())
      @flycam.update())
    @flycam.update()


  loadSkeletonFromModel : (trees, finishedDeferred) ->

    unless trees? then trees = @model.cellTracing.getTrees()

    for tree in trees

      treeGeometry = @getTreeGeometry(tree.treeId)
      treeGeometry.clear()
      treeGeometry.addNodes( tree.nodes )

    for branchpoint in @cellTracing.branchStack
      treeGeometry = @getTreeGeometry(branchpoint.treeId)
      treeGeometry.updateNodeColor(branchpoint.id, null, true)

    @setActiveNode()

    if finishedDeferred?
      finishedDeferred.resolve()

    @flycam.update()


  setBranch : (isBranchPoint, node) ->

    treeGeometry = @getTreeGeometry( node.treeId )
    treeGeometry.updateNodeColor(node.id, null, isBranchPoint)

    @flycam.update()


  setParticleSize : (size) ->

    for tree in @treeGeometries
      tree.setSize( size )
    @flycam.update()


  updateActiveTreeColor : (oldTreeId) ->

    treeGeometry = @getTreeGeometry(oldTreeId)
    newTreeId    = @cellTracing.getActiveTreeId()
    treeGeometry.updateTreeColor( newTreeId )
    @flycam.update()


  getMeshes : =>

    meshes = []
    for tree in @treeGeometries
      meshes = meshes.concat( tree.getMeshes() )
    return meshes

  setWaypoint : (centered) =>

    curGlobalPos = @flycam.getPosition()
    treeGeometry = @getTreeGeometry(@cellTracing.getTree().treeId)

    treeGeometry.addNode( @cellTracing.getActiveNode() )

    # Animation to center waypoint position
    position = @cellTracing.getActiveNodePos()
    if centered
      @waypointAnimation = new TWEEN.Tween({ globalPosX: curGlobalPos[0], globalPosY: curGlobalPos[1], globalPosZ: curGlobalPos[2], flycam: @flycam})
      @waypointAnimation.to({globalPosX: position[0], globalPosY: position[1], globalPosZ: position[2]}, 200)
      @waypointAnimation.onUpdate ->
        @flycam.setPosition [@globalPosX, @globalPosY, @globalPosZ]
      @waypointAnimation.start()

    @flycam.update()


  deleteNode : (node, treeId) ->

    $.assert(node.neighbors.length == 1,
      "Node needs to have exactly 1 neighbor.", 0)

    treeGeometry = @getTreeGeometry(treeId)
    treeGeometry.deleteNode(node)

    @flycam.update()


  mergeTree : (lastTreeID, lastNode, activeNode) ->

    lastTree   = @getTreeGeometry(lastTreeID)
    activeTree = @getTreeGeometry(@cellTracing.getTree().treeId)

    activeTree.mergeTree(lastTree, lastNode, activeNode)


  deleteTree : (index) ->

    treeGeometry = @treeGeometries[index]

    @trigger "removeGeometries", treeGeometry.getMeshes()
    treeGeometry.dispose()
    @treeGeometries.splice(index, 1)

    @flycam.update()


  setActiveNode : ->

    if @lastActiveNode?
      treeGeometry = @getTreeGeometry( @lastActiveNode.treeId )
      treeGeometry?.updateNodeColor( @lastActiveNode.id, false )

    if (activeNode = @model.cellTracing.getActiveNode())?
      treeGeometry = @getTreeGeometry( activeNode.treeId )
      treeGeometry?.updateNodeColor( activeNode.id, true )

    @lastActiveNode = activeNode


  getAllNodes : ->

    return (tree.nodes for tree in @treeGeometries)


  getTreeGeometry : (treeId) ->

    unless treeId
      treeId = @cellTracing.getTree().treeId
    for tree in @treeGeometries
      if tree.id == treeId
        return tree
    return null


  setVisibility : (isVisible) ->

    for mesh in @getMeshes()
      mesh.visible = isVisible
    @flycam.update()


  toggleInactiveTreeVisibility : ->

    @showInactiveTrees = not @showInactiveTrees
    @setInactiveTreeVisibility(@showInactiveTrees)


  setInactiveTreeVisibility : (visible) ->

    for mesh in @getMeshes()
      mesh.visible = visible
    treeGeometry = @getTreeGeometry(@cellTracing.getTree().treeId)
    treeGeometry.edges.visible = true
    treeGeometry.nodes.visible = true
    @flycam.update()


  setSizeAttenuation : (sizeAttenuation) ->

    for tree in @treeGeometries
      tree.setSizeAttenuation( sizeAttenuation )