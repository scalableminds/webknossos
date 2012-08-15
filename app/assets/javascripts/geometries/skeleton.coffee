### define
model : Model
###

class Skeleton

  # This class is supposed to collect all the Geometries that belong to the skeleton, like
  # nodes, edges and trees

  constructor : (maxRouteLen, flycam) ->
    @maxRouteLen = maxRouteLen
    @flycam = flycam

    @createRoute(maxRouteLen)

  createRoute : (maxRouteLen) ->
    # create route to show in previewBox and pre-allocate buffers
    @maxRouteLen = maxRouteLen

    routeGeometry = new THREE.Geometry()
    routeGeometryNodes = new THREE.Geometry()
    routeGeometry.dynamic = true
    routeGeometryNodes.dynamic = true

    i = 0
    while i < maxRouteLen
      # workaround to hide the unused vertices
      routeGeometryNodes.vertices.push(new THREE.Vector2(0,0))
      i += 1

    i = 0
    while i < 2 * maxRouteLen
      routeGeometry.vertices.push(new THREE.Vector2(0,0))
      i += 1

    route = new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({color: 0xff0000, linewidth: 1}), THREE.LinePieces)
    routeNodes = new THREE.ParticleSystem(routeGeometryNodes, new THREE.ParticleBasicMaterial({color: 0xff0000, size: 5, sizeAttenuation : false}))

    # set initial ray threshold to define initial click area
    @particles = []

    @route = route
    @routeNodes = routeNodes

  setActiveNodePosition : (position) =>
    @lastNodePosition = position

  getMeshes : =>
    [@route, @routeNodes]

  setWaypoint : (position, typeNumber) =>
    curGlobalPos = @flycam.getGlobalPos()
      
    console.log position

    unless @curIndex
      @curIndex = 0
      @lastNodePosition = position

    console.log position, @curIndex, @maxRouteLen

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