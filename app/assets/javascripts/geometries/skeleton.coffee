### define
model : Model
model/route : Route
###

PLANE_XY = 0
PLANE_YZ = 1
PLANE_XZ = 2
VIEW_3D  = 3

class Skeleton

  # This class is supposed to collect all the Geometries that belong to the skeleton, like
  # nodes, edges and trees

  constructor : (maxRouteLen, flycam, model) ->
    @maxRouteLen = maxRouteLen
    @flycam = flycam
    @model = model

    @createRoute(maxRouteLen, Route.data.task)

  createRoute : (maxRouteLen, initData) ->
    # create route to show in previewBox and pre-allocate buffers
    @maxRouteLen = maxRouteLen

    routeGeometry = new THREE.Geometry()
    routeGeometryNodes = new THREE.Geometry()
    routeGeometry.dynamic = true
    routeGeometryNodes.dynamic = true

    #index = 0
    #for t of initData.trees
    #  index = t
    #for edge in initData.trees[index].edges
    #  nodePos = initData.trees[index].nodes[edge.source].position
    #  node2Pos = initData.trees[index].nodes[edge.target].position
    #  routeGeometry.vertices.push(new THREE.Vector3(nodePos[0], nodePos[1], nodePos[2]))
    #  routeGeometry.vertices.push(new THREE.Vector3(node2Pos[0], node2Pos[1], node2Pos[2]))
    #  i += 2

    for i in [1..2 * @maxRouteLen]
      # workaround to hide the unused vertices
      routeGeometry.vertices.push(new THREE.Vector2(0,0))
      if i <= @maxRouteLen
        routeGeometryNodes.vertices.push(new THREE.Vector2(0,0))

    # initialize edit position
    #if i != 0
    #  nodePos = initData.trees[index].nodes[initData.activeNode].position
    #  @lastNodePosition = nodePos

    # initialize nodes
    #i = 0
    #while i < maxRouteLen
    #  if initData.trees[index].nodes[i]
    #    nodePos = initData.trees[index].nodes[i].position
    #    routeGeometryNodes.vertices.push(new THREE.Vector3(nodePos[0], nodePos[1], nodePos[2]))
    #    @curIndex = i + 1
    #  else
    #  i += 1

    @route = new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({color: 0xff0000, linewidth: 1}), THREE.LinePieces)
    @routeNodes = new THREE.ParticleSystem(routeGeometryNodes, new THREE.ParticleBasicMaterial({color: 0xff0000, size: 5, sizeAttenuation : false}))

    # Initialize the tree
    @clearRoute()
    @loadSkeletonFromModel()

  clearRoute : ->
    for i in [0..2 * @maxRouteLen - 1]
      # workaround to hide the unused vertices
      @route.geometry.vertices[i]      = new THREE.Vector2(0,0)
      if i < @maxRouteLen
        @routeNodes.geometry.vertices[i] = new THREE.Vector2(0,0)
      @route.geometry.verticesNeedUpdate = true
      @routeNodes.geometry.verticesNeedUpdate = true
    @curIndex = 0

  loadSkeletonFromModel : ->
    nodeList = @model.Route.getNodeList()
    console.log nodeList
    # Draw first Node, because it has no parent and therefore isn't drawn in the loop below
    if nodeList.length > 0
      nodePos = nodeList[0].pos
      @routeNodes.geometry.vertices[@curIndex]    = new THREE.Vector3(nodePos[0], nodePos[1], nodePos[2])
      @routeNodes.geometry.vertices[@curIndex].id = nodeList[0].id
    @curIndex++
    for node in nodeList
      if node.parent
        nodePos = node.parent.pos
        node2Pos = node.pos
        @route.geometry.vertices[2 * @curIndex]     = new THREE.Vector3(nodePos[0], nodePos[1], nodePos[2])
        @route.geometry.vertices[2 * @curIndex + 1] = new THREE.Vector3(node2Pos[0], node2Pos[1], node2Pos[2])
        @routeNodes.geometry.vertices[@curIndex]    = new THREE.Vector3(node2Pos[0], node2Pos[1], node2Pos[2])
        # Assign the ID to the vertex, so we can access it later
        @routeNodes.geometry.vertices[@curIndex].id = node.id
        @curIndex++


    @lastNodePosition = @model.Route.getActiveNodePos()
    @route.geometry.verticesNeedUpdate = true
    @routeNodes.geometry.verticesNeedUpdate = true

  setActiveNodePosition : (position) =>
    @lastNodePosition = position
    #@updateRoute()

  getMeshes : =>
    [@route, @routeNodes]

  # Looks for the Active Point in Model.Route and adds it to
  # the Skeleton View
  setWaypoint : =>
    curGlobalPos = @flycam.getGlobalPos()
    activePlane  = @flycam.getActivePlane()
    zoomFactor   = @flycam.getPlaneScalingFactor activePlane
    position     = @model.Route.getActiveNodePos()
    typeNumber   = @model.Route.getActiveNodeType()
    id           = @model.Route.getActiveNodeId()

    #if typeNumber == 0
      # calculate the global position of the rightclick
    #  switch activePlane
    #    when PLANE_XY then position = [curGlobalPos[0] - (@curWidth/2 - position[0])/@x*zoomFactor, curGlobalPos[1] - (@curWidth/2 - position[1])/@x*zoomFactor, curGlobalPos[2]]
    #    when PLANE_YZ then position = [curGlobalPos[0], curGlobalPos[1] - (@curWidth/2 - position[1])/@x*zoomFactor, curGlobalPos[2] - (@curWidth/2 - position[0])/@x*zoomFactor]
    #    when PLANE_XZ then position = [curGlobalPos[0] - (@curWidth/2 - position[0])/@x*zoomFactor, curGlobalPos[1], curGlobalPos[2] - (@curWidth/2 - position[1])/@x*zoomFactor]
      
    unless @curIndex
      @curIndex = 0
      @lastNodePosition = position

    if @curIndex < @maxRouteLen

    #PERFORMANCE TEST
    #for k in [0...@maxRouteLen] 
      #@curIndex = k
      #position[0] = Math.random() * 5000
      #position[1] = Math.random() * 5000
      #position[2] = Math.random() * 5000

      @route.geometry.vertices[2 * @curIndex] = new THREE.Vector3(@lastNodePosition[0], @lastNodePosition[1], @lastNodePosition[2])
      @route.geometry.vertices[2 * @curIndex + 1] = new THREE.Vector3(position[0], position[1], position[2])
      @routeNodes.geometry.vertices[@curIndex] = new THREE.Vector3(position[0], position[1], position[2])
      # Assign the ID to the vertex, so we can access it later
      @routeNodes.geometry.vertices[@curIndex].id = id

      #for i in [0..2]
      #  ind = @flycam.getIndices i
      #  @routeView[i].geometry.vertices[2 * @curIndex] = new THREE.Vector3(@lastNodePosition[ind[0]], -@lastNodePosition[ind[1]], -@lastNodePosition[ind[2]])
      #  @routeView[i].geometry.vertices[2 * @curIndex + 1] = new THREE.Vector3(position[ind[0]], -position[ind[1]], -position[ind[2]])
      #  @routeView[i].geometry.verticesNeedUpdate = true

      @route.geometry.verticesNeedUpdate = true
      @routeNodes.geometry.verticesNeedUpdate = true
      
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
    
      @lastNodePosition = position
      @curIndex += 1
      @flycam.hasChanged = true

  #updateRoute : =>
  #  gPos  = @flycam.getGlobalPos()
  #  scale = [@flycam.getPlaneScalingFactor(PLANE_XY), @flycam.getPlaneScalingFactor(PLANE_YZ), @flycam.getPlaneScalingFactor(PLANE_XZ)]
  
    #for i in [0..2]
    #  ind = @flycam.getIndices i
    #  @routeView[i].scale    = new THREE.Vector3(1/scale[i], 1/scale[i], 1/scale[i])
    #  @routeView[i].position = new THREE.Vector3(-gPos[ind[0]]/scale[i], gPos[ind[1]]/scale[i], gPos[ind[2]]/scale[i]+1)
    #  @routeView[i].geometry.verticesNeedUpdate = true