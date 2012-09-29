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

  constructor : (maxRouteLen, flycam) ->
    @maxRouteLen = maxRouteLen
    @flycam = flycam

    @createRoute(maxRouteLen, Route.data.task)

  createRoute : (maxRouteLen, initData) ->
    # create route to show in previewBox and pre-allocate buffers
    @maxRouteLen = maxRouteLen

    routeGeometry = new THREE.Geometry()
    routeGeometryNodes = new THREE.Geometry()
    routeGeometry.dynamic = true
    routeGeometryNodes.dynamic = true
    #routeGeometryView = new Array(3)

    #for i in [0..2]
    #  routeGeometryView[i] = new THREE.Geometry()
    #  routeGeometryView[i].dynamic = true

    # initialize edges
    i = 0
    index = 0
    for t of initData.trees
      index = t
    for edge in initData.trees[index].edges
      nodePos = initData.trees[index].nodes[edge.source].position
      node2Pos = initData.trees[index].nodes[edge.target].position
      routeGeometry.vertices.push(new THREE.Vector3(nodePos[0], nodePos[1], nodePos[2]))
      routeGeometry.vertices.push(new THREE.Vector3(node2Pos[0], node2Pos[1], node2Pos[2]))
      #for g in routeGeometryView
      #  g.vertices.push(new THREE.Vector3(nodePos[0], nodePos[1], nodePos[2]))
      #  g.vertices.push(new THREE.Vector3(node2Pos[0], node2Pos[1], node2Pos[2]))
      i += 2

    while i < 2 * maxRouteLen
      # workaround to hide the unused vertices
      routeGeometry.vertices.push(new THREE.Vector2(0,0))
      #for g in routeGeometryView
      #  g.vertices.push(new THREE.Vector2(0, 0))
      i += 1

    # initialize edit position
    if i != 0
      nodePos = initData.trees[index].nodes[initData.activeNode].position
      @lastNodePosition = nodePos

    # initialize nodes
    i = 0
    while i < maxRouteLen
      if initData.trees[index].nodes[i]
        nodePos = initData.trees[index].nodes[i].position
        routeGeometryNodes.vertices.push(new THREE.Vector3(nodePos[0], nodePos[1], nodePos[2]))
        @curIndex = i + 1
      else
        routeGeometryNodes.vertices.push(new THREE.Vector2(0,0))
      i += 1

    @route = new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({color: 0xff0000, linewidth: 1}), THREE.LinePieces)
    #@routeView = new Array(3)
    #for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
    #  @routeView[i] = new THREE.Line(routeGeometryView[i], new THREE.LineBasicMaterial({color: 0xff0000, linewidth: 1}), THREE.LinePieces)
    @routeNodes = new THREE.ParticleSystem(routeGeometryNodes, new THREE.ParticleBasicMaterial({color: 0xff0000, size: 5, sizeAttenuation : false}))

    # Initializing Position
    gPos = @flycam.getGlobalPos()
    #for i in [0..2]
    #  ind = @flycam.getIndices i
    #  @routeView[i].position = new THREE.Vector3(-gPos[ind[0]], gPos[ind[1]], gPos[ind[2]])

    # set initial ray threshold to define initial click area
    @particles = []
    #@rayThreshold = 100

  setActiveNodePosition : (position) =>
    @lastNodePosition = position
    #@updateRoute()

  getMeshes : =>
    [@route, @routeNodes]

  setWaypoint : (position, typeNumber) =>
    curGlobalPos = @flycam.getGlobalPos()
    activePlane  = @flycam.getActivePlane()
    zoomFactor   = @flycam.getPlaneScalingFactor activePlane

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

  onPreviewClick : (position, scaleFactor, camera) =>
    # vector with direction from camera position to click position
    vector = new THREE.Vector3((position[0] / (384 * scaleFactor) ) * 2 - 1, - (position[1] / (384 * scaleFactor)) * 2 + 1, 0.5)
    
    # create a ray with the direction of this vector, set ray threshold depending on the zoom of the 3D-view
    projector = new THREE.Projector()
    ray = projector.pickingRay(vector, camera)
    ray.setThreshold(@flycam.getRayThreshold())

    # identify clicked object
    intersects = ray.intersectObjects([@routeNodes])

    if (intersects.length > 0 and intersects[0].distance >= 0)
      intersects[0].object.material.color.setHex(Math.random() * 0xffffff)
      objPos = intersects[0].object.geometry.vertices[intersects[0].vertex]
      # jump to the nodes position
      @flycam.setGlobalPos [objPos.x, objPos.y, objPos.z]

      #@updateRoute()

  #updateRoute : =>
  #  gPos  = @flycam.getGlobalPos()
  #  scale = [@flycam.getPlaneScalingFactor(PLANE_XY), @flycam.getPlaneScalingFactor(PLANE_YZ), @flycam.getPlaneScalingFactor(PLANE_XZ)]
  
    #for i in [0..2]
    #  ind = @flycam.getIndices i
    #  @routeView[i].scale    = new THREE.Vector3(1/scale[i], 1/scale[i], 1/scale[i])
    #  @routeView[i].position = new THREE.Vector3(-gPos[ind[0]]/scale[i], gPos[ind[1]]/scale[i], gPos[ind[2]]/scale[i]+1)
    #  @routeView[i].geometry.verticesNeedUpdate = true