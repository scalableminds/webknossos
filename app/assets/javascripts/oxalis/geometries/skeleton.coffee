### define
../model : Model
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

    @skeletonTracing    = @model.skeletonTracing
    @treeGeometries = []
    @isVisible      = true

    @showInactiveTrees = true
    
    @reset()

    @skeletonTracing.on
      newActiveNode : => 
        @setActiveNode()
        @setInactiveTreeVisibility(@showInactiveTrees)
      newActiveNodeRadius : =>
        @setActiveNodeRadius()
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
        @skeletonTracing.one("finishedRender", =>
          @skeletonTracing.one("finishedRender", =>
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

    for tree in @skeletonTracing.getTrees()
      @createNewTree(tree.treeId, tree.color)

    @skeletonTracing.one("finishedRender", =>
      @skeletonTracing.one("finishedRender", =>
        @loadSkeletonFromModel())
      @flycam.update())
    @flycam.update()


  loadSkeletonFromModel : (trees, finishedDeferred) ->

    unless trees? then trees = @model.skeletonTracing.getTrees()

    for tree in trees

      treeGeometry = @getTreeGeometry(tree.treeId)
      treeGeometry.clear()
      treeGeometry.addNodes( tree.nodes )

    for branchpoint in @skeletonTracing.branchStack
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
    newTreeId    = @skeletonTracing.getActiveTreeId()
    treeGeometry.updateTreeColor( newTreeId )
    @flycam.update()


  getMeshes : =>

    meshes = []
    for tree in @treeGeometries
      meshes = meshes.concat( tree.getMeshes() )
    return meshes

  setWaypoint : (centered) =>

    curGlobalPos = @flycam.getPosition()
    treeGeometry = @getTreeGeometry(@skeletonTracing.getTree().treeId)

    treeGeometry.addNode( @skeletonTracing.getActiveNode() )

    # Animation to center waypoint position
    position = @skeletonTracing.getActiveNodePos()
    if centered
      @waypointAnimation = new TWEEN.Tween({ globalPosX: curGlobalPos[0], globalPosY: curGlobalPos[1], globalPosZ: curGlobalPos[2], flycam: @flycam})
      @waypointAnimation.to({globalPosX: position[0], globalPosY: position[1], globalPosZ: position[2]}, 200)
      @waypointAnimation.onUpdate ->
        @flycam.setPosition [@globalPosX, @globalPosY, @globalPosZ]
      @waypointAnimation.start()

    @flycam.update()


  deleteNode : (node, treeId) ->

    $.assertEquals(node.neighbors.length, 1, "Node needs to have exactly 1 neighbor.")

    treeGeometry = @getTreeGeometry(treeId)
    treeGeometry.deleteNode(node)

    @flycam.update()


  mergeTree : (lastTreeID, lastNode, activeNode) ->

    lastTree   = @getTreeGeometry(lastTreeID)
    activeTree = @getTreeGeometry(@skeletonTracing.getTree().treeId)

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

    if (activeNode = @model.skeletonTracing.getActiveNode())?
      treeGeometry = @getTreeGeometry( activeNode.treeId )
      treeGeometry?.updateNodeColor( activeNode.id, true )

    @lastActiveNode = activeNode


  setActiveNodeRadius : ->

    if (activeNode = @model.skeletonTracing.getActiveNode())?
      treeGeometry = @getTreeGeometry( activeNode.treeId )
      treeGeometry?.updateNodeRadius( activeNode.id, activeNode.radius )
      @flycam.update()


  getAllNodes : ->

    return (tree.nodes for tree in @treeGeometries)


  getTreeGeometry : (treeId) ->

    unless treeId
      treeId = @skeletonTracing.getTree().treeId
    for tree in @treeGeometries
      if tree.id == treeId
        return tree
    return null


  setVisibilityTemporary : (isVisible) ->

    for mesh in @getMeshes()
      mesh.visible = isVisible
    @flycam.update()


  setVisibility : (@isVisible) ->

    @flycam.update()

  restoreVisibility : ->

    @setVisibilityTemporary( @isVisible )


  toggleVisibility : ->

    @setVisibility( not @isVisible )


  updateForCam : (id) ->

    for tree in @treeGeometries
      tree.showRadius( id != constants.TDView )

    if id in constants.ALL_PLANES
      @setVisibilityTemporary( @isVisible )
    else
      @setVisibilityTemporary( true )


  toggleInactiveTreeVisibility : ->

    @showInactiveTrees = not @showInactiveTrees
    @setInactiveTreeVisibility(@showInactiveTrees)


  setInactiveTreeVisibility : (visible) ->

    for mesh in @getMeshes()
      mesh.visible = visible
    treeGeometry = @getTreeGeometry(@skeletonTracing.getTree().treeId)
    treeGeometry.edges.visible = true
    treeGeometry.nodes.visible = true
    @flycam.update()


  setSizeAttenuation : (sizeAttenuation) ->

    for tree in @treeGeometries
      tree.setSizeAttenuation( sizeAttenuation )
