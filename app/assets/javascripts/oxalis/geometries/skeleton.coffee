### define
backbone : Backbone
../model : Model
../model/dimensions : Dimensions
../../libs/resizable_buffer : ResizableBuffer
../constants : constants
./tree : Tree
###

class Skeleton

  # This class is supposed to collect all the Geometries that belong to the skeleton, like
  # nodes, edges and trees

  COLOR_ACTIVE : 0xff0000

  constructor : (@flycam, @model) ->

    _.extend(this, Backbone.Events)

    @skeletonTracing    = @model.skeletonTracing
    @treeGeometries = []
    @isVisible      = true

    @showInactiveTrees = true

    @reset()

    @listenTo(@skeletonTracing, "newActiveNode", (nodeId) ->
      @setActiveNode()
      @setInactiveTreeVisibility(@showInactiveTrees)
    )
    @listenTo(@skeletonTracing, "newActiveNodeRadius", @setActiveNodeRadius)
    @listenTo(@skeletonTracing, "newTree", (treeId, treeColor) ->
      @createNewTree(treeId, treeColor)
      @setInactiveTreeVisibility(@showInactiveTrees)
    )
    @listenTo(@skeletonTracing, "deleteTree", @deleteTree)
    @listenTo(@skeletonTracing, "deleteActiveNode", @deleteNode)
    @listenTo(@skeletonTracing, "mergeTree", @mergeTree)
    @listenTo(@skeletonTracing, "newNode", @setWaypoint)
    @listenTo(@skeletonTracing, "setBranch", @setBranch)
    @listenTo(@skeletonTracing, "newTreeColor", @updateTreeColor)
    @listenTo(@skeletonTracing, "reloadTrees", (trees, finishedDeferred) ->
      @skeletonTracing.once("finishedRender", =>
        @skeletonTracing.once("finishedRender", =>
          @loadSkeletonFromModel(trees, finishedDeferred))
        @flycam.update())
      @flycam.update()
    )

    @listenTo(@model.user, "particleSizeChanged", @setParticleSize)


  createNewTree : (treeId, treeColor) ->

    @treeGeometries.push( tree = new Tree(treeId, treeColor, @model) )
    @setActiveNode()
    @trigger("newGeometries", tree.getMeshes())


  # Will completely reload the trees from model.
  # This needs to be done at initialization

  reset : ->

    for tree in @treeGeometries
      @trigger("removeGeometries", tree.getMeshes())
      tree.dispose()

    @treeGeometries = []

    for tree in @skeletonTracing.getTrees()
      @createNewTree(tree.treeId, tree.color)

    @skeletonTracing.once("finishedRender", =>
      @skeletonTracing.once("finishedRender", =>
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


  updateTreeColor : (treeId) ->

    @getTreeGeometry(treeId).updateTreeColor()
    @flycam.update()


  getMeshes : =>

    meshes = []
    for tree in @treeGeometries
      meshes = meshes.concat(tree.getMeshes())
    return meshes

  setWaypoint : (centered) =>

    curGlobalPos = @flycam.getPosition()
    treeGeometry = @getTreeGeometry(@skeletonTracing.getTree().treeId)

    treeGeometry.addNode(@skeletonTracing.getActiveNode())

    # Animation to center waypoint position
    position = @skeletonTracing.getActiveNodePos()
    if centered
      @waypointAnimation = new TWEEN.Tween({ globalPosX: curGlobalPos[0], globalPosY: curGlobalPos[1], globalPosZ: curGlobalPos[2], flycam: @flycam})
      @waypointAnimation.to({globalPosX: position[0], globalPosY: position[1], globalPosZ: position[2]}, 200)
      @waypointAnimation.onUpdate ->
        @flycam.setPosition([@globalPosX, @globalPosY, @globalPosZ])
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

    @trigger("removeGeometries", treeGeometry.getMeshes())
    treeGeometry.dispose()
    @treeGeometries.splice(index, 1)

    @flycam.update()


  setActiveNode : ->

    if @lastActiveNode?
      treeGeometry = @getTreeGeometry(@lastActiveNode.treeId)
      treeGeometry?.updateNodeColor(@lastActiveNode.id, false)

    if (activeNode = @model.skeletonTracing.getActiveNode())?
      treeGeometry = @getTreeGeometry(activeNode.treeId)
      treeGeometry?.updateNodeColor(activeNode.id, true)

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
      mesh.visible = isVisible && (if mesh.isVisible? then mesh.isVisible else true)
    @flycam.update()


  setVisibility : (@isVisible) ->

    @flycam.update()


  restoreVisibility : ->

    @setVisibilityTemporary( @isVisible )


  toggleVisibility : ->

    @setVisibility( not @isVisible )


  updateForCam : (id) ->

    for tree in @treeGeometries
      tree.showRadius( id != constants.TDView and
        not @model.user.get("overrideNodeRadius") )

    if id in constants.ALL_PLANES
      @setVisibilityTemporary( @isVisible )
    else
      @setVisibilityTemporary( true )


  toggleInactiveTreeVisibility : ->

    @showInactiveTrees = not @showInactiveTrees
    @setInactiveTreeVisibility(@showInactiveTrees)


  setInactiveTreeVisibility : (visible) ->

    for mesh in @getMeshes()
      mesh.isVisible = visible
    treeGeometry = @getTreeGeometry(@skeletonTracing.getTree().treeId)
    treeGeometry.edges.isVisible = true
    treeGeometry.nodes.isVisible = true
    @flycam.update()


  setSizeAttenuation : (sizeAttenuation) ->

    for tree in @treeGeometries
      tree.setSizeAttenuation(sizeAttenuation)
