### define
../model : Model
../model/route : Route
../model/dimensions : Dimensions
../../libs/event_mixin : EventMixin
../../libs/resizable_buffer : ResizableBuffer
###

PLANE_XY           = Dimensions.PLANE_XY
PLANE_YZ           = Dimensions.PLANE_YZ
PLANE_XZ           = Dimensions.PLANE_XZ
VIEW_3D            = Dimensions.VIEW_3D

TYPE_NORMAL = 0
TYPE_BRANCH = 1

COLOR_ACTIVE = 0xff0000
COLOR_BRANCH = 0x0000ff
COLOR_ACTIVE_BRANCH = 0x660000

class Skeleton

  # This class is supposed to collect all the Geometries that belong to the skeleton, like
  # nodes, edges and trees

  flycam : null
  model : null

  # Edges
  routes : []
  # Nodes
  nodes : []
  nodeSpheres : []
  # Tree IDs
  ids : []
  # Current Index
  curIndex : []
  # whether or not display the spheres
  disSpheres : true

  constructor : (@flycam, @model) ->

    _.extend(this, new EventMixin())

    @scaleVector  = @model.scaleInfo.getVoxelPerNMVector()
    # Edges
    @routes       = []
    # Nodes
    @nodes        = []
    @nodesSpheres = []
    # Tree IDs
    @ids          = []

    @route        = @model.route
    # Buffer
    @edgesBuffer  = []
    @nodesBuffer  = []

    # Create sphere to represent the active Node, radius is
    # 1 nm, so that @activeNode.scale is the radius in nm.
    # @activeNode = new THREE.Mesh(
    #     new THREE.SphereGeometry(1),
    #     new THREE.MeshLambertMaterial({
    #       color : COLOR_ACTIVE
    #       #transparent: true
    #       #opacity: 0.5 })
    #       })
    #   )
    # @activeNode.doubleSided = true

    activeNodeGeometry = new THREE.Geometry()
    @activeNodeParticle = new THREE.ParticleSystem(
      activeNodeGeometry,
        new THREE.ParticleBasicMaterial({color: COLOR_ACTIVE, size: 5, sizeAttenuation : false}))
    activeNodeGeometry.vertices.push(new THREE.Vector3(0, 0, 0))

    routeGeometryBranchPoints = new THREE.Geometry()
    routeGeometryBranchPoints.dynamic = true
    @branches = new THREE.ParticleSystem(
        routeGeometryBranchPoints,
        new THREE.ParticleBasicMaterial({size: 5, sizeAttenuation: false, vertexColors: true}))
    @branchesBuffer = new ResizableBuffer(3)
    @branchesColorsBuffer = new ResizableBuffer(3)

    @updateBranches()

    @route.on
      newActiveNode : => @setActiveNode()
      newTree : (treeId, treeColor) => @createNewTree(treeId, treeColor)
      deleteTree : (index) => @deleteTree(index)
      deleteActiveNode : (node) => @deleteNode(node)
      mergeTree : (lastTreeID, lastNode, activeNode) => 
        @mergeTree(lastTreeID, lastNode, activeNode)
        @updateBranches()
      newNode : => @setWaypoint()
      setBranch : (isBranchPoint, nodeID) => 
        @setBranchPoint(isBranchPoint, nodeID)
        @updateBranches()
      deleteBranch : => @updateBranches()
      # spheres currently disabled
      #newActiveNodeRadius : (radius) => @setNodeRadius(radius)
      reloadTrees : (trees) =>
        @route.one("rendered", =>
          @route.one("rendered", =>
            @loadSkeletonFromModel(trees)))
      removeSpheresOfTree : (nodes) => @removeSpheresOfTree(nodes)
      newParticleSize : (size) => @setParticleSize(size)

    @reset()

  createNewTree : (treeId, treeColor) ->
    # create route to show in previewBox and pre-allocate buffers

    routeGeometry = new THREE.Geometry()
    routeGeometryNodes = new THREE.Geometry()
    routeGeometryNodes.nodeIDs = new ResizableBuffer(1, 100, Int32Array)
    routeGeometry.dynamic = true
    routeGeometryNodes.dynamic = true

    @edgesBuffer.push(new ResizableBuffer(6))
    @nodesBuffer.push(new ResizableBuffer(3))

    @routes.push(new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({color: @darkenHex(treeColor), linewidth: @model.route.getParticleSize() / 4}), THREE.LinePieces))
    @nodes.push(new THREE.ParticleSystem(routeGeometryNodes, new THREE.ParticleBasicMaterial({color: @darkenHex(treeColor), size: @model.route.getParticleSize(), sizeAttenuation : false})))
    @ids.push(treeId)

    @setActiveNode()

    @trigger "newGeometries", [@routes[@routes.length - 1], @nodes[@nodes.length - 1]]


  # Will completely reload the trees from model.
  # This needs to be done at initialization
  reset : ->
    if (@ids.length > 0)
      @trigger "removeGeometries", @routes.concat(@nodes).concat(@nodesSpheres)

    for threeLine in @routes
      threeLine.geometry.dispose()
      threeLine.material.dispose()
    for threeParticleSystem in @nodes
      threeParticleSystem.geometry.dispose()
      threeParticleSystem.material.dispose()

    @routes       = []
    @nodes        = []
    @ids          = []
    @nodesSpheres = []
    @edgesBuffer  = []
    @nodesBuffer  = []

    for tree in @route.getTrees()
      @createNewTree(tree.treeId, tree.color)

    # Add Spheres to the scene
    @trigger "newGeometries", @nodesSpheres
    
    @route.one("rendered", =>
      @route.one("rendered", =>
        @loadSkeletonFromModel()))

  loadSkeletonFromModel : (trees) ->
    unless trees? then trees = @model.route.getTrees()
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
        # currently disabled due to performance issues
        # @pushNewNode(node.radius, node.pos, node.id, tree.color, node.type)

        # Add edges to neighbor, if neighbor id is smaller
        # (so we don't add the same edge twice)
        for neighbor in node.neighbors
          if neighbor.id < node.id
            @edgesBuffer[index].push(neighbor.pos.concat(node.pos))


      @routes[index].geometry.__vertexArray = @edgesBuffer[index].getBuffer()
      @routes[index].geometry.__webglLineCount = @edgesBuffer[index].getLength() * 2
      @nodes[index].geometry.__vertexArray = @nodesBuffer[index].getBuffer()
      @nodes[index].geometry.__webglParticleCount =  @nodesBuffer[index].getLength()

      @routes[index].geometry.verticesNeedUpdate = true
      @nodes[index].geometry.verticesNeedUpdate = true
    # for branchPoint in @route.branchStack
    #   @setBranchPoint(true, branchPoint.id)
    @updateBranches()

    @setActiveNode()

  setActiveNode : =>
    id = @route.getActiveNodeId()
    position = @route.getActiveNodePos()
    if @activeNodeSphere and @disSpheres==true
      @activeNodeSphere.visible = true
    # May be null
    @lastNodePosition = position
    if position
      @activeNodeParticle.visible = true
      @activeNodeSphere = @getSphereFromId(id)
      # Hide activeNodeSphere, because activeNode is visible anyway
      #if @activeNodeSphere
      #  @activeNodeSphere.visible = false
      if @route.getActiveNodeType() == TYPE_BRANCH
        @activeNodeParticle.material.color.setHex(@invertHex(@route.getTree().color))
      else
        @activeNodeParticle.material.color.setHex(@route.getTree().color)

      # @setNodeRadius(@route.getActiveNodeRadius())
      @activeNodeParticle.position = new THREE.Vector3(position[0] + 0.02, position[1] + 0.02, position[2] - 0.02)
    else
      #@activeNodeSphere = null
      @activeNodeParticle.visible = false
    @flycam.hasChanged = true

  setBranchPoint : (isBranchPoint, nodeID) ->
    treeColor = @route.getTree().color
    if isBranchPoint
      colorActive = @invertHex(treeColor)
    else 
      colorActive = treeColor
    
    #colorNormal = if isBranchPoint then treeColor * 0.7 else treeColor
    if not nodeID? or nodeID == @route.getActiveNodeId()
      @activeNodeParticle.material.color.setHex(colorActive)
    #   if @activeNodeSphere
    #     @activeNodeSphere.material.color.setHex(colorNormal)
    # else
    #   sphere = @getSphereFromId(nodeID)
    #   if sphere?
    #     sphere.material.color.setHex(colorNormal)
    @flycam.hasChanged = true

  setNodeRadius : (radius) ->
    vRadius = new THREE.Vector3(radius, radius, radius)
    @activeNode.scale = @calcScaleVector(vRadius)
    if @activeNodeSphere
      @activeNodeSphere.scale = @calcScaleVector(vRadius)
    @flycam.hasChanged = true

  setParticleSize : (size) ->
    for particleSystem in @nodes
      particleSystem.material.size = size
    for line in @routes
      line.material.linewidth = size / 4
    @branches.material.size = size
    @activeNodeParticle.material.size = size
    @flycam.hasChanged = true

  getMeshes : =>
    return [@activeNodeParticle].concat(@nodes).concat(@nodesSpheres).concat(@routes).concat(@branches)

  setWaypoint : =>
    curGlobalPos = @flycam.getPosition()
    activePlane  = @flycam.getActivePlane()
    position     = @route.getActiveNodePos()
    id           = @route.getActiveNodeId()
    index        = @getIndexFromTreeId(@route.getTree().treeId)
    color        = @route.getTree().color
    radius       = @route.getActiveNodeRadius()
    type         = @route.getActiveNodeType()

    if !@nodesBuffer[index].getLength()
      @lastNodePosition = position
    unless @lastNodePosition
      @lastNodePosition = position

    # ASSUMPTION: last node has smaller ID
    if @nodesBuffer[index].getLength() > 0
      @edgesBuffer[index].push(@lastNodePosition.concat(position))

    @nodesBuffer[index].push(position)
    @nodes[index].geometry.nodeIDs.push([id])

    @nodes[index].geometry.__vertexArray = @nodesBuffer[index].getBuffer()
    @nodes[index].geometry.__webglParticleCount = @nodesBuffer[index].getLength()
    @routes[index].geometry.__vertexArray = @edgesBuffer[index].getBuffer()
    @routes[index].geometry.__webglLineCount = @edgesBuffer[index].getLength() * 2

    # @pushNewNode(radius, position, id, color, type)

    @routes[index].geometry.verticesNeedUpdate = true
    @nodes[index].geometry.verticesNeedUpdate = true

    # Animation to center waypoint position
    @waypointAnimation = new TWEEN.Tween({ globalPosX: curGlobalPos[0], globalPosY: curGlobalPos[1], globalPosZ: curGlobalPos[2], flycam: @flycam})
    @waypointAnimation.to({globalPosX: position[0], globalPosY: position[1], globalPosZ: position[2]}, 100)
    @waypointAnimation.onUpdate ->
      @flycam.setPosition [@globalPosX, @globalPosY, @globalPosZ]
    @waypointAnimation.start()
  
    @setActiveNode()
    #@setNodeRadius(radius)
    @flycam.hasChanged = true

  deleteNode : (node) ->
    $.assert(node.neighbors.length == 1,
      "Node needs to have exactly 1 neighbor.", 0)

    index = @getIndexFromTreeId(@route.getTree().treeId)

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
        found &= Math.abs(@routes[index].geometry.__vertexArray[6 * i + j] - edgeArray[j]) < 0.01
      if found
        edgesIndex = i
        break

    $.assert(found,
      "No edge found.", found)

    # swap edges by popping the last one (which consists of two nodes) and inserting it into the position of the deleted one
    lastEdge = @edgesBuffer[index].pop()
    for i in [0..5]
      @edgesBuffer[index].getAllElements()[edgesIndex * 6 + i] = lastEdge[i]

    
    @routes[index].geometry.__vertexArray = @edgesBuffer[index].getBuffer()
    @routes[index].geometry.__webglLineCount = @edgesBuffer[index].getLength() * 2
    @nodes[index].geometry.__vertexArray = @nodesBuffer[index].getBuffer()
    @nodes[index].geometry.__webglParticleCount =  @nodesBuffer[index].getLength()

    @routes[index].geometry.verticesNeedUpdate = true
    @nodes[index].geometry.verticesNeedUpdate = true

    @trigger("removeGeometries", [@getSphereFromId(node.id)])
    @setActiveNode()
    @flycam.hasChanged = true

  mergeTree : (lastTreeID, lastNode, activeNode) ->
    lastIndex = @getIndexFromTreeId(lastTreeID)
    index = @getIndexFromTreeId(@route.getTree().treeId)

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

    @routes[index].geometry.__vertexArray = @edgesBuffer[index].getBuffer()
    @routes[index].geometry.__webglLineCount = @edgesBuffer[index].getLength() * 2
    @nodes[index].geometry.__vertexArray = @nodesBuffer[index].getBuffer()
    @nodes[index].geometry.__webglParticleCount =  @nodesBuffer[index].getLength()

    @routes[index].geometry.verticesNeedUpdate = true
    @nodes[index].geometry.verticesNeedUpdate = true

    @flycam.hasChanged = true

  deleteTree : (index) ->

    # Remove all geometries and spheres
    nodeSpheres = (@popSphereFromId(nodeID) for nodeID in @nodes[index].geometry.nodeIDs.getAllElements())
    @trigger "removeGeometries", [@routes[index]].concat([@nodes[index]]).concat(nodeSpheres)

    # deallocate memory for THREE geometries and materials
    @routes[index].geometry.dispose()
    @routes[index].material.dispose()
    @nodes[index].geometry.dispose()
    @nodes[index].material.dispose()

    # Remove entries
    @ids.splice(index, 1)
    @routes.splice(index, 1)
    @nodes.splice(index, 1)
    @edgesBuffer.splice(index, 1)
    @nodesBuffer.splice(index, 1)

    @setActiveNode()
    @flycam.hasChanged = true

  updateBranches : ->

    branchpoints = @route.branchStack

    @branchesBuffer.clear()
    @branchesBuffer.pushMany([
      branchpoint.pos[0] + 0.01,
      branchpoint.pos[1] + 0.01, 
      branchpoint.pos[2] - 0.01] for branchpoint in branchpoints)

    @branchesColorsBuffer.clear()
    @branchesColorsBuffer.pushMany(@invertHexToRGB(@darkenHex(@model.route.getTree(branchpoint.treeId).color)) for branchpoint in branchpoints)

    @branches.geometry.__vertexArray = @branchesBuffer.getBuffer()
    @branches.geometry.__webglParticleCount = @branchesBuffer.getLength()
    @branches.geometry.__colorArray = @branchesColorsBuffer.getBuffer()
    @branches.geometry.verticesNeedUpdate = true
    @branches.geometry.colorsNeedUpdate = true
    @flycam.hasChanged = true


  pushNewNode : (radius, position, id, color, type) ->
    color = if type == TYPE_BRANCH then color * 0.7 else color
    newNode = new THREE.Mesh(
      new THREE.SphereGeometry(1),
      new THREE.MeshLambertMaterial({ color : color})#, transparent: true, opacity: 0.5 })
    )
    newNode.scale = @calcScaleVector(new THREE.Vector3(radius, radius, radius))
    newNode.position = new THREE.Vector3(position...)
    newNode.nodeId = id
    newNode.visible = @disSpheres
    newNode.doubleSided = true
    @nodesSpheres.push(newNode)
    @trigger "newGeometries", [newNode]

  getIndexFromTreeId : (treeId) ->
    unless treeId
      treeId = @route.getTree().treeId
    for i in [0..@ids.length]
      if @ids[i] == treeId
        return i
    return null

  removeSpheresOfTree : (nodes) ->
    nodeSpheres = (@popSphereFromId(node.id) for node in nodes)
    @trigger "removeGeometries", nodeSpheres

  getSphereFromId : (nodeId) ->
    for node in @nodesSpheres
      if node.nodeId == nodeId
        return node

  popSphereFromId : (nodeId) ->
    i = 0
    while i < @nodesSpheres.length
      if @nodesSpheres[i].nodeId == nodeId
        node = @nodesSpheres[i]
        @nodesSpheres.splice(i, 1)
        return node
      else
        i++

  setDisplaySpheres : (value) ->
    @disSpheres = value
    for sphere in @nodesSpheres
      if sphere != @activeNodeSphere
        sphere.visible = value

  # Helper function
  calcScaleVector : (v) ->
    return (new THREE.Vector3()).multiplyVectors(v, @scaleVector)

  setVisibility : (isVisible) ->
    for mesh in @getMeshes()
      mesh.visible = isVisible
    if isVisible
      @setActiveNode()
      @setDisplaySpheres(@disSpheres)
    @flycam.hasChanged = true


  invertHexToRGB : (hexColor) ->

    hsvColor = new THREE.Color().setHex(hexColor).getHSV()
    hsvColor.h = (hsvColor.h + 0.5) % 1
    rgbColor = new THREE.Color().setHSV(hsvColor.h, hsvColor.s, hsvColor.v)
    [rgbColor.r, rgbColor.g, rgbColor.b]


  darkenHex : (hexColor) ->

    hsvColor = new THREE.Color().setHex(hexColor).getHSV()
    hsvColor.v = 0.6
    new THREE.Color().setHSV(hsvColor.h, hsvColor.s, hsvColor.v).getHex()


  invertHex : (hexColor) ->

    hsvColor = new THREE.Color().setHex(hexColor).getHSV()
    hsvColor.h = (hsvColor.h + 0.5) % 1
    new THREE.Color().setHSV(hsvColor.h, hsvColor.s, hsvColor.v).getHex()

  setSizeAttenuation : (boolean) ->

    for particleSystem in @nodes
      particleSystem.material.sizeAttenuation = boolean
      particleSystem.material.needsUpdate = true
    @branches.material.sizeAttenuation = boolean
    @activeNodeParticle.material.sizeAttenuation = boolean