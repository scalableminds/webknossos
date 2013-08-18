### define
../model : Model
../model/celltracing : CellTracing
../model/dimensions : Dimensions
../../libs/event_mixin : EventMixin
../../libs/resizable_buffer : ResizableBuffer
../constants : constants
libs/threejs/ColorConverter : ColorConverter
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

    activeNodeGeometry = new THREE.Geometry()
    @activeNodeParticle = new THREE.ParticleSystem(
      activeNodeGeometry,
      new THREE.ParticleBasicMaterial({
        color: @COLOR_ACTIVE, 
        size: 5, 
        sizeAttenuation : false}))
    activeNodeGeometry.vertices.push(new THREE.Vector3(0, 0, 0))

    branchPointsGeometry = new THREE.Geometry()
    branchPointsGeometry.dynamic = true
    @branches = new THREE.ParticleSystem(
      branchPointsGeometry,
      new THREE.ParticleBasicMaterial({
        size: 5, 
        sizeAttenuation: false, 
        vertexColors: true}))
    @branchesBuffer = new ResizableBuffer(3)
    @branchesColorsBuffer = new ResizableBuffer(3)
    
    @reset()

    @updateBranches()

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
        @updateBranches()
      newNode : (centered) => @setWaypoint(centered)
      setBranch : (isBranchPoint, nodeID) => 
        @setBranchPoint(isBranchPoint, nodeID)
        @updateBranches()
      deleteBranch : => @updateBranches()
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
    
    @treeGeometries.push( tree = new Tree(treeId, @darkenHex( treeColor ), @model) )

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

    @updateBranches()
    @setActiveNode()

    if finishedDeferred?
      finishedDeferred.resolve()


  setActiveNode : =>

    id = @cellTracing.getActiveNodeId()
    position = @cellTracing.getActiveNodePos()
    # May be null
    @lastNodePosition = position
    if position
      @activeNodeParticle.visible = true
      if @cellTracing.getActiveNodeType() == constants.TYPE_BRANCH
        @activeNodeParticle.material.color.setHex(@invertHex(@cellTracing.getTree().color))
      else
        @activeNodeParticle.material.color.setHex(@cellTracing.getTree().color)

      @activeNodeParticle.position = new THREE.Vector3(position[0] + 0.02, position[1] + 0.02, position[2] - 0.02)
    else
      @activeNodeParticle.visible = false
    @flycam.update()


  setBranchPoint : (isBranchPoint, nodeID) ->

    treeColor = @cellTracing.getTree().color
    if isBranchPoint
      colorActive = @invertHex(treeColor)
    else 
      colorActive = treeColor
    
    if not nodeID? or nodeID == @cellTracing.getActiveNodeId()
      @activeNodeParticle.material.color.setHex(colorActive)
    @flycam.update()


  setParticleSize : (size) ->

    for tree in @treeGeometries
      tree.setSize( size )
    @branches.material.size = size
    @activeNodeParticle.material.size = size
    @flycam.update()


  updateActiveTreeColor : (oldTreeId) ->

    treeGeometry = @getTreeGeometry(oldTreeId)
    treeColor    = @cellTracing.getTree().color

    newTreeId    = @cellTracing.getActiveTreeId()
    newColor     = new THREE.Color(@darkenHex(treeColor))
    @treeGeometry.updateColor( newTreeId, newColor )

    @updateBranches()
    @setActiveNode()


  getMeshes : =>

    meshes = [@activeNodeParticle].concat(@branches)
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
  
      @setActiveNode()

    @flycam.update()


  deleteNode : (node, treeId) ->

    $.assert(node.neighbors.length == 1,
      "Node needs to have exactly 1 neighbor.", 0)

    treeGeometry = @getTreeGeometry(treeId)
    treeGeometry.deleteNode(node)

    @setActiveNode()
    @flycam.update()


  mergeTree : (lastTreeID, lastNode, activeNode) ->

    lastTree   = @getTreeGeometry(lastTreeID)
    activeTree = @getTreeGeometry(@cellTracing.getTree().treeId)

    activeTree.mergeTree(lastTree, lastNode, activeNode)

    @flycam.update()


  deleteTree : (index) ->

    treeGeometry = @treeGeometries[index]

    @trigger "removeGeometries", treeGeometry.getMeshes()
    treeGeometry.dispose()
    @treeGeometries.splice(index, 1)

    @setActiveNode()
    @flycam.update()


  updateBranches : ->

    branchpoints = @cellTracing.branchStack

    @branchesBuffer.clear()
    @branchesBuffer.pushMany([
      branchpoint.pos[0] + 0.01,
      branchpoint.pos[1] + 0.01, 
      branchpoint.pos[2] - 0.01] for branchpoint in branchpoints)

    @branchesColorsBuffer.clear()
    @branchesColorsBuffer.pushMany(@invertHexToRGB(@darkenHex(@model.cellTracing.getTree(branchpoint.treeId).color)) for branchpoint in branchpoints)

    @branches.geometry.__vertexArray = @branchesBuffer.getBuffer()
    @branches.geometry.__webglParticleCount = @branchesBuffer.getLength()
    @branches.geometry.__colorArray = @branchesColorsBuffer.getBuffer()
    @branches.geometry.verticesNeedUpdate = true
    @branches.geometry.colorsNeedUpdate = true
    @flycam.update()


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
    if isVisible
      @setActiveNode()
    @flycam.update()


  toggleInactiveTreeVisibility : ->

    @showInactiveTrees = not @showInactiveTrees
    @setInactiveTreeVisibility(@showInactiveTrees)


  setInactiveTreeVisibility : (visible) ->

    for mesh in @getMeshes()
      if mesh != @activeNodeParticle
        mesh.visible = visible
    treeGeometry = @getTreeGeometry(@cellTracing.getTree().treeId)
    treeGeometry.edges.visible = true
    treeGeometry.nodes.visible = true
    @flycam.update()
    

  invertHexToRGB : (hexColor) ->

    hsvColor = ColorConverter.getHSV(new THREE.Color().setHex(hexColor))
    hsvColor.h = (hsvColor.h + 0.5) % 1
    rgbColor = ColorConverter.setHSV(new THREE.Color(), hsvColor.h, hsvColor.s, hsvColor.v)
    [rgbColor.r, rgbColor.g, rgbColor.b]


  darkenHex : (hexColor) ->

    hsvColor = ColorConverter.getHSV(new THREE.Color().setHex(hexColor))
    hsvColor.v = 0.6
    ColorConverter.setHSV(new THREE.Color(), hsvColor.h, hsvColor.s, hsvColor.v).getHex()


  invertHex : (hexColor) ->

    hsvColor = ColorConverter.getHSV(new THREE.Color().setHex(hexColor))
    hsvColor.h = (hsvColor.h + 0.5) % 1
    ColorConverter.setHSV(new THREE.Color(), hsvColor.h, hsvColor.s, hsvColor.v).getHex()

  setSizeAttenuation : (sizeAttenuation) ->

    for tree in @treeGeometries
      tree.setSizeAttenuation( sizeAttenuation )

    @branches.material.sizeAttenuation = sizeAttenuation
    @branches.material.needsUpdate = true
    @activeNodeParticle.material.sizeAttenuation = sizeAttenuation
    @activeNodeParticle.material.needsUpdate = true