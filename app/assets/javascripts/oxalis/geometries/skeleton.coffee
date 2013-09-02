### define
../model : Model
../model/celltracing : CellTracing
../model/dimensions : Dimensions
../../libs/event_mixin : EventMixin
../../libs/resizable_buffer : ResizableBuffer
../constants : constants
libs/threejs/ColorConverter : ColorConverter
###

class Skeleton

  # This class is supposed to collect all the Geometries that belong to the skeleton, like
  # nodes, edges and trees

  COLOR_ACTIVE : 0xff0000
  
  constructor : (@flycam, @model) ->

    _.extend(this, new EventMixin())

    @scaleVector  = @model.scaleInfo.getVoxelPerNMVector()
    # Edges
    @edges        = []
    # Nodes
    @nodes        = []
    # Tree IDs
    @ids          = []

    @cellTracing        = @model.cellTracing
    # Buffer
    @edgesBuffer  = []
    @nodesBuffer  = []

    #initial mode
    @mode = constants.MODE_PLANE_TRACING
    @showInactiveTrees = true

    activeNodeGeometry = new THREE.Geometry()
    @activeNodeParticle = new THREE.ParticleSystem(
      activeNodeGeometry,
      new THREE.ParticleBasicMaterial({
        color: @COLOR_ACTIVE, 
        size: 5, 
        sizeAttenuation : @mode == constants.MODE_ARBITRARY}))
    activeNodeGeometry.vertices.push(new THREE.Vector3(0, 0, 0))

    branchPointsGeometry = new THREE.Geometry()
    branchPointsGeometry.dynamic = true
    @branches = new THREE.ParticleSystem(
      branchPointsGeometry,
      new THREE.ParticleBasicMaterial({
        size: 5, 
        sizeAttenuation: @mode == constants.MODE_ARBITRARY, 
        vertexColors: true}))
    @branchesBuffer = new ResizableBuffer(3)
    @branchesColorsBuffer = new ResizableBuffer(3)

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

    @reset()


  createNewTree : (treeId, treeColor) ->
    # create cellTracing to show in TDView and pre-allocate buffers

    edgeGeometry = new THREE.Geometry()
    nodeGeometry = new THREE.Geometry()
    nodeGeometry.nodeIDs = new ResizableBuffer(1, 100, Int32Array)
    edgeGeometry.dynamic = true
    nodeGeometry.dynamic = true

    @edgesBuffer.push(new ResizableBuffer(6))
    @nodesBuffer.push(new ResizableBuffer(3))

    @edges.push(new THREE.Line(
      edgeGeometry, 
      new THREE.LineBasicMaterial({
        color: @darkenHex(treeColor), 
        linewidth: @model.user.particleSize / 4}), THREE.LinePieces))

    @nodes.push(new THREE.ParticleSystem(
      nodeGeometry, 
      new THREE.ParticleBasicMaterial({
        color: @darkenHex(treeColor), 
        size: @model.user.particleSize, 
        sizeAttenuation : @mode == constants.MODE_ARBITRARY})))

    @ids.push(treeId)

    @setActiveNode()

    @trigger "newGeometries", [@edges[@edges.length - 1], @nodes[@nodes.length - 1]]


  # Will completely reload the trees from model.
  # This needs to be done at initialization

  reset : ->

    if (@ids.length > 0)
      @trigger "removeGeometries", @edges.concat(@nodes)

    for threeLine in @edges
      threeLine.geometry.dispose()
      threeLine.material.dispose()
    for threeParticleSystem in @nodes
      threeParticleSystem.geometry.dispose()
      threeParticleSystem.material.dispose()

    @edges       = []
    @nodes        = []
    @ids          = []
    @edgesBuffer  = []
    @nodesBuffer  = []

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
      nodeList = tree.nodes
      index = @getIndexFromTreeId(tree.treeId)

      @nodesBuffer[index].clear()
      @edgesBuffer[index].clear()
      @nodes[index].geometry.nodeIDs.clear()

      if nodeList.length
        @nodesBuffer[index].pushMany(node.pos for node in nodeList)
        # Assign the ID to the vertex, so we can access it later
        @nodes[index].geometry.nodeIDs.pushSubarray(node.id for node in nodeList)

      for node in nodeList
        # Add edges to neighbor, if neighbor id is smaller
        # (so we don't add the same edge twice)
        for neighbor in node.neighbors
          if neighbor.id < node.id
            @edgesBuffer[index].push(neighbor.pos.concat(node.pos))

      @updateGeometries(index)
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


  setNodeRadius : (radius) ->

    vRadius = new THREE.Vector3(radius, radius, radius)
    @activeNode.scale = @calcScaleVector(vRadius)
    @flycam.update()


  setParticleSize : (size) ->

    for particleSystem in @nodes
      particleSystem.material.size = size
    for line in @edges
      line.material.linewidth = size / 4
    @branches.material.size = size
    @activeNodeParticle.material.size = size
    @flycam.update()


  updateActiveTreeColor : (oldTreeId) ->

    index = @getIndexFromTreeId(oldTreeId)
    treeColor = @cellTracing.getTree().color

    @ids[index] = @cellTracing.getActiveTreeId()
    @nodes[index].material.color = new THREE.Color(@darkenHex(treeColor))
    @edges[index].material.color = new THREE.Color(@darkenHex(treeColor))

    @nodes[index].material.needsUpdate = true
    @edges[index].material.needsUpdate = true

    @updateBranches()
    @setActiveNode()


  getMeshes : =>

    return [@activeNodeParticle].concat(@nodes).concat(@edges).concat(@branches)


  setWaypoint : (centered) =>

    curGlobalPos = @flycam.getPosition()
    position     = @cellTracing.getActiveNodePos()
    id           = @cellTracing.getActiveNodeId()
    index        = @getIndexFromTreeId(@cellTracing.getTree().treeId)
    color        = @cellTracing.getTree().color
    radius       = @cellTracing.getActiveNodeRadius()
    type         = @cellTracing.getActiveNodeType()

    if !@nodesBuffer[index].getLength()
      @lastNodePosition = position
    unless @lastNodePosition
      @lastNodePosition = position

    # ASSUMPTION: last node has smaller ID
    if @nodesBuffer[index].getLength() > 0
      @edgesBuffer[index].push(@lastNodePosition.concat(position))

    @nodesBuffer[index].push(position)
    @nodes[index].geometry.nodeIDs.push([id])

    @updateGeometries(index)

    # Animation to center waypoint position
    if centered
      #@waypointAnimation = new TWEEN.Tween({ globalPosX: curGlobalPos[0], globalPosY: curGlobalPos[1], globalPosZ: curGlobalPos[2], flycam: @flycam})
      #@waypointAnimation.to({globalPosX: position[0], globalPosY: position[1], globalPosZ: position[2]}, 200)
      #@waypointAnimation.onUpdate ->
      #  @flycam.setPosition [@globalPosX, @globalPosY, @globalPosZ]
      #@waypointAnimation.start()
  
      @setActiveNode()

    @flycam.update()


  deleteNode : (node, treeId) ->

    $.assert(node.neighbors.length == 1,
      "Node needs to have exactly 1 neighbor.", 0)

    index = @getIndexFromTreeId(treeId)

    for i in [0...@nodes[index].geometry.nodeIDs.getLength()]
      if @nodes[index].geometry.nodeIDs.getAllElements()[i] == node.id
        nodesIndex = i
        break

    # swap IDs
    @nodes[index].geometry.nodeIDs.getAllElements()[nodesIndex] = @nodes[index].geometry.nodeIDs.pop()

    # swap nodes by popping the last one and inserting it into the position of the deleted one
    lastNode = @nodesBuffer[index].pop()
    for i in [0..2]
      @nodesBuffer[index].getAllElements()[nodesIndex * 3 + i] = lastNode[i]

    # Delete Edge by finding it in the array
    # ASSUMPTION edges always go from smaller ID to bigger ID
    if node.id < node.neighbors[0].id
      edgeArray = node.pos.concat(node.neighbors[0].pos)
    else
      edgeArray = node.neighbors[0].pos.concat(node.pos)
    for i in [0...@edgesBuffer[index].getLength()]
      found = true
      for j in [0..5]
        found &= Math.abs(@edges[index].geometry.__vertexArray[6 * i + j] - edgeArray[j]) < 0.01
      if found
        edgesIndex = i
        break

    $.assert(found,
      "No edge found.", found)

    # swap edges by popping the last one (which consists of two nodes) and inserting it into the position of the deleted one
    lastEdge = @edgesBuffer[index].pop()
    for i in [0..5]
      @edgesBuffer[index].getAllElements()[edgesIndex * 6 + i] = lastEdge[i]

    
    @updateGeometries(index)

    @setActiveNode()
    @flycam.update()


  mergeTree : (lastTreeID, lastNode, activeNode) ->

    lastIndex = @getIndexFromTreeId(lastTreeID)
    index = @getIndexFromTreeId(@cellTracing.getTree().treeId)

    # merge IDs
    @nodes[index].geometry.nodeIDs.pushSubarray(@nodes[lastIndex].geometry.nodeIDs.getAllElements())

    # merge nodes
    @nodesBuffer[index].pushSubarray(@nodesBuffer[lastIndex].getAllElements())

    # merge edges
    if lastNode.id < activeNode.id
      @edgesBuffer[index].push( lastNode.pos.concat(activeNode.pos) )
    else
      @edgesBuffer[index].push( activeNode.pos.concat(lastNode.pos) )
    @edgesBuffer[index].pushSubarray(@edgesBuffer[lastIndex].getAllElements())

    @updateGeometries(index)

    @flycam.update()


  deleteTree : (index) ->

    @trigger "removeGeometries", [@edges[index]].concat([@nodes[index]])

    # deallocate memory for THREE geometries and materials
    @edges[index].geometry.dispose()
    @edges[index].material.dispose()
    @nodes[index].geometry.dispose()
    @nodes[index].material.dispose()

    # Remove entries
    @ids.splice(index, 1)
    @edges.splice(index, 1)
    @nodes.splice(index, 1)
    @edgesBuffer.splice(index, 1)
    @nodesBuffer.splice(index, 1)

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


  getIndexFromTreeId : (treeId) ->

    unless treeId
      treeId = @cellTracing.getTree().treeId
    for i in [0..@ids.length]
      if @ids[i] == treeId
        return i
    return null


  calcScaleVector : (v) ->
    # Helper function

    return (new THREE.Vector3()).multiplyVectors(v, @scaleVector)

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
    index = @getIndexFromTreeId(@cellTracing.getTree().treeId)
    @edges[index].visible = true
    @nodes[index].visible = true
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

    @mode = if sizeAttenuation then constants.MODE_ARBITRARY else constants.MODE_PLANE_TRACING
    for particleSystem in @nodes
      particleSystem.material.sizeAttenuation = sizeAttenuation
      particleSystem.material.needsUpdate = true
    @branches.material.sizeAttenuation = sizeAttenuation
    @branches.material.needsUpdate = true
    @activeNodeParticle.material.sizeAttenuation = sizeAttenuation
    @activeNodeParticle.material.needsUpdate = true
  
  updateGeometries: (index) ->

    edges = @edges[index].geometry
    nodes = @nodes[index].geometry

    edges.__vertexArray = @edgesBuffer[index].getBuffer()
    edges.__webglLineCount = @edgesBuffer[index].getLength() * 2
    nodes.__vertexArray = @nodesBuffer[index].getBuffer()
    nodes.__webglParticleCount =  @nodesBuffer[index].getLength()

    edges.verticesNeedUpdate = true
    nodes.verticesNeedUpdate = true
