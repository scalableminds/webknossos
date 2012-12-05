### define
model : Model
model/route : Route
libs/event_mixin : EventMixin
libs/dimensions : DimensionsHelper
###

PLANE_XY           = Dimensions.PLANE_XY
PLANE_YZ           = Dimensions.PLANE_YZ
PLANE_XZ           = Dimensions.PLANE_XZ
VIEW_3D            = Dimensions.VIEW_3D

TYPE_BRANCH = 1

COLOR_ACTIVE = 0x0000ff
COLOR_BRANCH = 0x550000
COLOR_BRANCH_ACTIVE = 0x000055

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

    # Create sphere to represent the active Node, radius is
    # 1 nm, so that @activeNode.scale is the radius in nm.
    @activeNode = new THREE.Mesh(
        new THREE.SphereGeometry(1),
        new THREE.MeshLambertMaterial({
          color : COLOR_ACTIVE
          #transparent: true
          #opacity: 0.5 })
          })
      )
    @activeNode.doubleSided = true

    @route.on("newActiveNode", =>
      @setActiveNode())

    @route.on("newTree", (treeId, treeColor) =>
      @createNewTree(treeId, treeColor))

    @route.on("deleteActiveTree", =>
      @reset())

    @route.on("deleteActiveNode", =>
      @reset())

    @route.on("deleteLastNode", (id) =>
      @deleteLastNode(id))

    @route.on("newNode", =>
      @setWaypoint())

    @route.on("setBranch", (isBranchPoint) =>
      @setBranchPoint(isBranchPoint))

    @route.on("newActiveNodeRadius", (radius) =>
      @setNodeRadius(radius))

    @reset()

  createNewTree : (treeId, treeColor) ->
    # create route to show in previewBox and pre-allocate buffers
    routeGeometry = new THREE.Geometry()
    routeGeometryNodes = new THREE.Geometry()
    routeGeometry.dynamic = true
    routeGeometryNodes.dynamic = true

    for i in [1..@maxRouteLen]
      # workaround to hide the unused vertices
      routeGeometry.vertices.push(new THREE.Vector2(0,0))      # sources
      routeGeometry.vertices.push(new THREE.Vector2(0,0))      # targets
      routeGeometryNodes.vertices.push(new THREE.Vector2(0,0)) # nodes

    @routes.push(new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({color: treeColor, linewidth: 1}), THREE.LinePieces))
    @nodes.push(new THREE.ParticleSystem(routeGeometryNodes, new THREE.ParticleBasicMaterial({color: treeColor, size: 5, sizeAttenuation : false})))
    @ids.push(treeId)
    @curIndex.push(0)

    # Initialize the tree
    @clearRoute(treeId)

    @setActiveNode()
    
    @trigger "newGeometries", [@routes[@routes.length - 1], @nodes[@nodes.length - 1]]

  clearRoute : (treeId) ->
    index = @getIndexFromTreeId(treeId)
    for i in [0..@maxRouteLen - 1]
      # workaround to hide the unused vertices
      @routes[index].geometry.vertices[2 * i]     = new THREE.Vector2(0,0)
      @routes[index].geometry.vertices[2 * i + 1] = new THREE.Vector2(0,0)
      @nodes[index].geometry.vertices[i] = new THREE.Vector2(0,0)
      @routes[index].geometry.verticesNeedUpdate = true
      @nodes[index].geometry.verticesNeedUpdate = true
    @curIndex[index] = 0


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

    for tree in @route.getTrees()
      @createNewTree(tree.treeId, tree.color)
    
    @loadSkeletonFromModel()
    # Add Spheres to the scene
    @trigger "newGeometries", @nodesSpheres

  loadSkeletonFromModel : ->
    for tree in @route.getTrees()
      nodeList = @route.getNodeList(tree)

      index = @getIndexFromTreeId(tree.treeId)

      # Check that we are not dealing with a sentinel
      if nodeList[0].id
        # Draw first Node, because it has no parent and therefore isn't drawn in the loop below
        if nodeList.length > 0
          radius = nodeList[0].size
          nodePos = nodeList[0].pos
          @nodes[index].geometry.vertices[@curIndex[index]]    = new THREE.Vector3(nodePos...)
          # Assign the ID to the vertex, so we can access it later
          @nodes[index].geometry.vertices[@curIndex[index]].nodeId = nodeList[0].id
          @pushNewNode(radius, nodePos, nodeList[0].id, tree.color)
        @curIndex[index]++
        for node in nodeList
          if node.parent
            radius = node.size
            nodePos = node.parent.pos
            node2Pos = node.pos
            @routes[index].geometry.vertices[2 * @curIndex[index]]     = new THREE.Vector3(nodePos...)
            @routes[index].geometry.vertices[2 * @curIndex[index] + 1] = new THREE.Vector3(node2Pos...)
            @nodes[index].geometry.vertices[@curIndex[index]]    = new THREE.Vector3(node2Pos...)
            # Assign the ID to the vertex, so we can access it later
            @nodes[index].geometry.vertices[@curIndex[index]].nodeId = node.id
            @pushNewNode(radius, node2Pos, node.id, tree.color)
            @curIndex[index]++
        @routes[index].geometry.verticesNeedUpdate = true
        @nodes[index].geometry.verticesNeedUpdate = true
    for branchPoint in @route.branchStack
      @setBranchPoint(true, branchPoint.id)
    @setActiveNode()

  setActiveNode : =>
    id = @route.getActiveNodeId()
    position = @route.getActiveNodePos()
    if @activeNodeSphere and @disSpheres==true
      @activeNodeSphere.visible = true
    # May be null
    @lastNodePosition = position
    if position
      @activeNode.visible = true
      @activeNodeSphere = @getSphereFromId(id)
      # Hide activeNodeSphere, because activeNode is visible anyway
      if @activeNodeSphere
        @activeNodeSphere.visible = false
        if @route.getActiveNodeType() == TYPE_BRANCH
          @activeNode.material.color.setHex(COLOR_BRANCH_ACTIVE)
        else
          @activeNode.material.color.setHex(COLOR_ACTIVE)

      @setNodeRadius(@route.getActiveNodeRadius())
      @activeNode.position = new THREE.Vector3(position...)
    else
      @activeNodeSphere = null
      @activeNode.visible = false
    @flycam.hasChanged = true

  setBranchPoint : (isBranchPoint, nodeID) ->
    colorActive = if isBranchPoint then COLOR_BRANCH_ACTIVE else COLOR_ACTIVE
    treeColor = @route.getTree().color
    colorNormal = if isBranchPoint then COLOR_BRANCH else treeColor
    if not nodeID? or nodeID == @route.getActiveNodeId()
      @activeNode.material.color.setHex(colorActive)
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
    return [@activeNode].concat(@routes).concat(@nodes).concat(@nodesSpheres)

  setWaypoint : =>
    curGlobalPos = @flycam.getGlobalPos()
    activePlane  = @flycam.getActivePlane()
    zoomFactor   = @flycam.getPlaneScalingFactor activePlane
    position     = @route.getActiveNodePos()
    typeNumber   = @route.getActiveNodeType()
    id           = @route.getActiveNodeId()
    index        = @getIndexFromTreeId(@route.getTree().treeId)
    color        = @route.getTree().color
    radius       = @route.getActiveNodeRadius()
   
    unless @curIndex[index]
      @curIndex[index] = 0
      @lastNodePosition = position
    unless @lastNodePosition
      @lastNodePosition = position

    if @curIndex[index] < @maxRouteLen

    #PERFORMANCE TEST
    #for k in [0...@maxRouteLen] 
      #@curIndex = k
      #position[0] = Math.random() * 5000
      #position[1] = Math.random() * 5000
      #position[2] = Math.random() * 5000

      @routes[index].geometry.vertices[2 * @curIndex[index]] = new THREE.Vector3(@lastNodePosition...)
      @routes[index].geometry.vertices[2 * @curIndex[index] + 1] = new THREE.Vector3(position...)
      @nodes[index].geometry.vertices[@curIndex[index]] = new THREE.Vector3(position...)
      # Assign the ID to the vertex, so we can access it later
      @nodes[index].geometry.vertices[@curIndex[index]].nodeId = id

      @trigger "newGeometries", [@pushNewNode(radius, position, id, color)]

      #for i in [0..2]
      #  ind = @flycam.getIndices i
      #  @routeView[i].geometry.vertices[2 * @curIndex] = new THREE.Vector3(@lastNodePosition[ind[0]], -@lastNodePosition[ind[1]], -@lastNodePosition[ind[2]])
      #  @routeView[i].geometry.vertices[2 * @curIndex + 1] = new THREE.Vector3(position[ind[0]], -position[ind[1]], -position[ind[2]])
      #  @routeView[i].geometry.verticesNeedUpdate = true

      @routes[index].geometry.verticesNeedUpdate = true
      @nodes[index].geometry.verticesNeedUpdate = true
      
      #TEST CUBES
      #particle = new THREE.Mesh(new THREE.CubeGeometry(30, 30, 30, 1, 1, 1), new THREE.MeshBasicMaterial({color: 0xff0000}))
      #particle.position.x = position[0]
      #particle.position.y = Game.dataSet.upperBoundary[2] - position[2]
      #particle.position.z = position[1]
      #@addGeometry VIEW_3D, particle

      # Animation to center waypoint position
      @waypointAnimation = new TWEEN.Tween({ globalPosX: curGlobalPos[0], globalPosY: curGlobalPos[1], globalPosZ: curGlobalPos[2], flycam: @flycam})
      @waypointAnimation.to({globalPosX: position[0], globalPosY: position[1], globalPosZ: position[2]}, 300)
      @waypointAnimation.onUpdate ->
        @flycam.setGlobalPos [@globalPosX, @globalPosY, @globalPosZ]
      @waypointAnimation.start()
    
      @setActiveNode()
      @setNodeRadius(radius)
      @curIndex[index]++
      @flycam.hasChanged = true

  deleteLastNode : (id) ->
    index = @getIndexFromTreeId(@route.getTree().treeId)

    if @nodes[index].geometry.vertices[@curIndex[index]-1].nodeId == id
      sphere = @getSphereFromId(id)

      if @curIndex[index] > 0
        @curIndex[index]--
        @lastNodePosition = @nodes[index].geometry.vertices[@curIndex[index]]
        @routes[index].geometry.vertices[2 * @curIndex[index]] = new THREE.Vector2(0,0)
        @routes[index].geometry.vertices[2 * @curIndex[index] + 1] = new THREE.Vector2(0,0)
        @nodes[index].geometry.vertices[@curIndex[index]] = new THREE.Vector2(0,0)
        @routes[index].geometry.verticesNeedUpdate = true
        @nodes[index].geometry.verticesNeedUpdate = true
      else
        @lastNodePosition = null

      @trigger("removeGeometries", [sphere])
      @setActiveNode()
      @flycam.hasChanged = true
    else
      @reset()

  pushNewNode : (radius, position, id, color) ->
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
    return newNode
      
  getIndexFromTreeId : (treeId) ->
    unless treeId
      treeId = @route.getTree().treeId
    for i in [0..@ids.length]
      if @ids[i] == treeId
        return i
    return null

  getSphereFromId : (nodeId) ->
    for node in @nodesSpheres
      if node.nodeId == nodeId
        return node

  setDisplaySpheres : (value) ->
    @disSpheres = value
    for sphere in @nodesSpheres
      if sphere != @activeNodeSphere
        sphere.visible = value

  # Helper function
  calcScaleVector : (v) ->
    return (new THREE.Vector3()).multiply(v, @scaleVector)
