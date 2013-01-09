### define
../model : Model
../model/route : Route
../model/dimensions : DimensionsHelper
../../libs/event_mixin : EventMixin
###

PLANE_XY           = Dimensions.PLANE_XY
PLANE_YZ           = Dimensions.PLANE_YZ
PLANE_XZ           = Dimensions.PLANE_XZ
VIEW_3D            = Dimensions.VIEW_3D

TYPE_NORMAL = 0
TYPE_BRANCH = 1

MAX_BRANCHES = 100

COLOR_ACTIVE = 0x0000ff

class Skeleton

  # This class is supposed to collect all the Geometries that belong to the skeleton, like
  # nodes, edges and trees

  maxRouteLen : 0
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

  constructor : (@maxRouteLen, @flycam, @model) ->

    _.extend(this, new EventMixin())

    @scaleVector  = @model.scaleInfo.getVoxelPerNMVector()
    # Edges
    @routes       = []
    # Nodes
    @nodes        = []
    @nodesSpheres = []
    # Tree IDs
    @ids          = []
    # Current Index
    @curIndex     = []
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
        new THREE.ParticleBasicMaterial({color: COLOR_ACTIVE, size: 10, sizeAttenuation : false}))
    activeNodeGeometry.vertices.push(new THREE.Vector3(0, 0, 0))

    routeGeometryBranchPoints = new THREE.Geometry()
    routeGeometryBranchPoints.dynamic = true
    @branches = new THREE.ParticleSystem(
        routeGeometryBranchPoints,
        new THREE.ParticleBasicMaterial({color: COLOR_ACTIVE * 0.7, size: 8, sizeAttenuation : false}))

    @route.on
      newActiveNode : => @setActiveNode()
      newTree : (treeId, treeColor) => @createNewTree(treeId, treeColor)
      deleteTree : (index) => @deleteTree(index)
      deleteActiveNode : (node) => @deleteNode(node)
      deleteLastNode : (id) => @deleteLastNode(id)
      mergeTree : (lastTreeID, lastNodePosition, activeNodePosition) => @mergeTree(lastTreeID, lastNodePosition, activeNodePosition)
      newNode : => @setWaypoint()
      setBranch : (isBranchPoint, nodeID) => 
        @setBranchPoint(isBranchPoint, nodeID)
        @updateBranches()
      # spheres currently disabled
      #newActiveNodeRadius : (radius) => @setNodeRadius(radius)
      reloadTrees : (trees) =>
        @route.one("rendered", =>
          @route.one("rendered", =>
            @loadSkeletonFromModel(trees)))
      removeSpheresOfTree : (nodes) => @removeSpheresOfTree(nodes)

    @reset()

  createNewTree : (treeId, treeColor) ->
    # create route to show in previewBox and pre-allocate buffers

    routeGeometry = new THREE.Geometry()
    routeGeometryNodes = new THREE.Geometry()
    routeGeometryNodes.nodeIDs = new Int32Array(@maxRouteLen * 3)
    routeGeometry.dynamic = true
    routeGeometryNodes.dynamic = true

    @edgesBuffer.push(new Float32Array(@maxRouteLen * 2 * 3))
    @nodesBuffer.push(new Float32Array(@maxRouteLen * 3))

    @routes.push(new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({color: treeColor, linewidth: 1}), THREE.LinePieces))
    @nodes.push(new THREE.ParticleSystem(routeGeometryNodes, new THREE.ParticleBasicMaterial({color: treeColor, size: 5, sizeAttenuation : false})))
    @ids.push(treeId)
    @curIndex.push(0)

    @setActiveNode()

    @trigger "newGeometries", [@routes[@routes.length - 1], @nodes[@nodes.length - 1]]


  # Will completely reload the trees from model.
  # This needs to be done at initialization or whenever
  # the skeleton is changes in a way that can't efficiently
  # applied to the particle system, like deleting nodes, trees.
  reset : ->
    if (@ids.length > 0)
      @trigger "removeGeometries", @routes.concat(@nodes).concat(@nodesSpheres)
    @routes       = []
    @nodes        = []
    @ids          = []
    @nodesSpheres = []
    @edgesBuffer  = []
    @nodesBuffer  = []
    @curIndex     = []

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
      @curIndex[index] = 0
      # We need to remember this, because it might temporaryly be
      # something other than (@curIndex[index] - 1)
      edgesIndex = 0

      for node in nodeList
        @nodesBuffer[index].set(node.pos, @curIndex[index] * 3)
        # Assign the ID to the vertex, so we can access it later
        @nodes[index].geometry.nodeIDs.set([node.id], @curIndex[index])
        # currently disabled due to performance issues
        # @pushNewNode(node.radius, node.pos, node.id, tree.color, node.type)
        @curIndex[index]++

        # Add edges to neighbor, if neighbor id is smaller
        # (so we don't add the same edge twice)
        for neighbor in node.neighbors
          if neighbor.id < node.id
            @edgesBuffer[index].set( neighbor.pos, (edgesIndex++) * 3 )
            @edgesBuffer[index].set(     node.pos, (edgesIndex++) * 3 )

      if edgesIndex != (2 * (@curIndex[index] - 1)) and !(@curIndex[index] == 0 and edgesIndex == 0)
        console.error("edgesIndex does not equal (2 * (@curIndex[index] - 1) !!!")

      @routes[index].geometry.__vertexArray = @edgesBuffer[index]
      @routes[index].geometry.__webglLineCount = 2 * (@curIndex[index] - 1)
      @nodes[index].geometry.__vertexArray = @nodesBuffer[index]
      @nodes[index].geometry.__webglParticleCount = @curIndex[index]

      @routes[index].geometry.verticesNeedUpdate = true
      @nodes[index].geometry.verticesNeedUpdate = true
    # for branchPoint in @route.branchStack
    #   @setBranchPoint(true, branchPoint.id)
    @updateBranches()
    # add branchesParticleSystem to scene
    @trigger "newGeometries", [@branches]

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
        @activeNodeParticle.material.color.setHex(COLOR_ACTIVE * 0.7)
      else
        @activeNodeParticle.material.color.setHex(COLOR_ACTIVE)

      # @setNodeRadius(@route.getActiveNodeRadius())
      @activeNodeParticle.position = new THREE.Vector3(position[0] + 0.01, position[1] + 0.01, position[2] - 0.01)
    else
      #@activeNodeSphere = null
      @activeNodeParticle.visible = false
    @flycam.hasChanged = true

  setBranchPoint : (isBranchPoint, nodeID) ->
    colorActive = if isBranchPoint then COLOR_ACTIVE * 0.7 else COLOR_ACTIVE
    treeColor = @route.getTree().color
    colorNormal = if isBranchPoint then treeColor * 0.7 else treeColor
    if not nodeID? or nodeID == @route.getActiveNodeId()
      @activeNodeParticle.material.color.setHex(colorActive)
      if @activeNodeSphere
        @activeNodeSphere.material.color.setHex(colorNormal)
    else
      sphere = @getSphereFromId(nodeID)
      if sphere?
        sphere.material.color.setHex(colorNormal)
    @flycam.hasChanged = true

  setNodeRadius : (radius) ->
    vRadius = new THREE.Vector3(radius, radius, radius)
    @activeNode.scale = @calcScaleVector(vRadius)
    if @activeNodeSphere
      @activeNodeSphere.scale = @calcScaleVector(vRadius)
    @flycam.hasChanged = true

  getMeshes : =>
    return [@activeNodeParticle].concat(@nodes).concat(@nodesSpheres).concat(@routes)

  setWaypoint : =>
    curGlobalPos = @flycam.getGlobalPos()
    activePlane  = @flycam.getActivePlane()
    position     = @route.getActiveNodePos()
    id           = @route.getActiveNodeId()
    index        = @getIndexFromTreeId(@route.getTree().treeId)
    color        = @route.getTree().color
    radius       = @route.getActiveNodeRadius()
    type         = @route.getActiveNodeType()

    unless @curIndex[index]
      @curIndex[index] = 0
      @lastNodePosition = position
    unless @lastNodePosition
      @lastNodePosition = position

    if @curIndex[index] < @maxRouteLen

      if @curIndex[index] > 0
        @edgesBuffer[index].set(@lastNodePosition, (2 * @curIndex[index] - 2) * 3)
        @edgesBuffer[index].set(position, (2 * @curIndex[index] - 1) * 3)

        @routes[index].geometry.__vertexArray = @edgesBuffer[index]
        @routes[index].geometry.__webglLineCount = 2 * @curIndex[index]

      @nodesBuffer[index].set(position, @curIndex[index] * 3)
      @nodes[index].geometry.nodeIDs.set([id], @curIndex[index])

      @nodes[index].geometry.__vertexArray = @nodesBuffer[index]
      @nodes[index].geometry.__webglParticleCount = @curIndex[index] + 1

      # @pushNewNode(radius, position, id, color, type)

      @routes[index].geometry.verticesNeedUpdate = true
      @nodes[index].geometry.verticesNeedUpdate = true

      # Animation to center waypoint position
      @waypointAnimation = new TWEEN.Tween({ globalPosX: curGlobalPos[0], globalPosY: curGlobalPos[1], globalPosZ: curGlobalPos[2], flycam: @flycam})
      @waypointAnimation.to({globalPosX: position[0], globalPosY: position[1], globalPosZ: position[2]}, 100)
      @waypointAnimation.onUpdate ->
        @flycam.setGlobalPos [@globalPosX, @globalPosY, @globalPosZ]
      @waypointAnimation.start()
    
      @setActiveNode()
      #@setNodeRadius(radius)
      @curIndex[index]++
      @flycam.hasChanged = true

  deleteNode : (node) ->

    if node.neighbors.length != 1
      console.error("Delete node that does not have exactly 1 neighbor?!")
      return

    index = @getIndexFromTreeId(@route.getTree().treeId)

    for i in [0...@curIndex[index]]
      if @nodes[index].geometry.nodeIDs[i] == node.id
        nodesIndex = i
        break

    # swap IDs
    @nodes[index].geometry.nodeIDs[nodesIndex] = @nodes[index].geometry.nodeIDs[@curIndex[index]-1]

    # swap nodes
    for i in [0..2]
      @nodes[index].geometry.__vertexArray[nodesIndex * 3 + i] =
        @nodes[index].geometry.__vertexArray[(@curIndex[index] - 1) * 3 + i]

    # Delete Edge by finding it in the array
    # ASSUMPTION edges always go from smaller ID to bigger ID
    if node.id < node.neighbors[0].id
      edgeArray = node.pos.concat(node.neighbors[0].pos)
    else
      edgeArray = node.neighbors[0].pos.concat(node.pos)
    for i in [0...@curIndex[index]]
      found = true
      for j in [0..5]
        found &= Math.abs(@routes[index].geometry.__vertexArray[6 * i + j] - edgeArray[j]) < 0.01
      if found
        edgesIndex = i
        break

    # swap edges
    for i in [0..5]
      @routes[index].geometry.__vertexArray[edgesIndex * 6 + i] =
        @routes[index].geometry.__vertexArray[(@curIndex[index] - 2) * 6 + i]
    

    @curIndex[index]--
    @routes[index].geometry.__webglLineCount = 2 * (@curIndex[index] - 1)
    @nodes[index].geometry.__webglParticleCount = @curIndex[index]
    @routes[index].geometry.verticesNeedUpdate = true
    @nodes[index].geometry.verticesNeedUpdate = true
    @trigger("removeGeometries", [@getSphereFromId(node.id)])
    @setActiveNode()
    @flycam.hasChanged = true

  mergeTree : (lastTreeID, lastNodePosition, activeNodePosition) ->
    lastIndex = @getIndexFromTreeId(lastTreeID)
    index = @getIndexFromTreeId(@route.getTree().treeId)

    # merge IDs
    @nodes[index].geometry.nodeIDs.set(@nodes[lastIndex].geometry.nodeIDs.subarray(0, @curIndex[lastIndex]), @curIndex[index])

    # merge nodes
    @nodes[index].geometry.__vertexArray.set(@nodes[lastIndex].geometry.__vertexArray.subarray(0, @curIndex[lastIndex] * 3), @curIndex[index] * 3)

    # merge edges
    if @curIndex[index] == 1
      @routes[index].geometry.__vertexArray = @edgesBuffer[index]
    @routes[index].geometry.__vertexArray.set([lastNodePosition..., activeNodePosition...], (@curIndex[index] - 1) * 6)
    @routes[index].geometry.__vertexArray.set(@routes[lastIndex].geometry.__vertexArray.subarray(0, (@curIndex[lastIndex] - 1) * 6), (@curIndex[index]) * 6)

    @curIndex[index] += @curIndex[lastIndex]
    @routes[index].geometry.__webglLineCount = 2 * (@curIndex[index] - 1)
    @nodes[index].geometry.__webglParticleCount = @curIndex[index]
    @routes[index].geometry.verticesNeedUpdate = true
    @nodes[index].geometry.verticesNeedUpdate = true
    @flycam.hasChanged = true

    #@deleteTree(lastIndex)

  deleteTree : (index) ->

    # Remove all geometries and spheres
    nodeSpheres = (@popSphereFromId(nodeID) for nodeID in @nodes[index].geometry.nodeIDs.subarray(0, @curIndex[index]))
    @trigger "removeGeometries", [@routes[index]].concat([@nodes[index]]).concat(nodeSpheres)

    # Remove entries
    @ids.splice(index, 1)
    @routes.splice(index, 1)
    @nodes.splice(index, 1)
    @edgesBuffer.splice(index, 1)
    @nodesBuffer.splice(index, 1)
    @curIndex.splice(index, 1)

    @setActiveNode()
    @flycam.hasChanged = true

  updateBranches : ->
    branchpoints = @route.branchStack
    for i in [0..MAX_BRANCHES]
      if i < branchpoints.length
        @branches.geometry.vertices[i] = new THREE.Vector3(
          branchpoints[i].pos[0] + 0.01,
          branchpoints[i].pos[1] + 0.01,
          branchpoints[i].pos[2] - 0.01)
      else
        @branches.geometry.vertices[i] = new THREE.Vector2(0, 0)
    @branches.geometry.verticesNeedUpdate = true
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
    return (new THREE.Vector3()).multiply(v, @scaleVector)
