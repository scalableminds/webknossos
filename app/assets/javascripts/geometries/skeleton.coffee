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
    @flycam      = flycam
    @model       = model
    # Edges
    @routes      = []
    # Nodes
    @nodes       = []
    # Tree IDs
    @ids         = []
    # Current Index
    @curIndex    = []

    for tree in @model.Route.getTrees()
      @createNewTree(tree.treeId)
    @loadSkeletonFromModel()

  createNewTree : (treeId) ->
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

    @routes.push(new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({color: 0xff0000, linewidth: 1}), THREE.LinePieces))
    @nodes.push(new THREE.ParticleSystem(routeGeometryNodes, new THREE.ParticleBasicMaterial({color: 0xff0000, size: 5, sizeAttenuation : false})))
    @ids.push(treeId)
    @curIndex.push(0)

    # Initialize the tree
    @clearRoute(treeId)

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

  loadSkeletonFromModel : ->
    for tree in @model.Route.getTrees()
      nodeList = @model.Route.getNodeList(tree)
      console.log nodeList

      index = @getIndexFromTreeId(tree.treeId)

      # Draw first Node, because it has no parent and therefore isn't drawn in the loop below
      if nodeList.length > 0
        nodePos = nodeList[0].pos
        @nodes[index].geometry.vertices[@curIndex[index]]    = new THREE.Vector3(nodePos[0], nodePos[1], nodePos[2])
        @nodes[index].geometry.vertices[@curIndex[index]].id = nodeList[0].id
      @curIndex[index]++
      for node in nodeList
        if node.parent
          nodePos = node.parent.pos
          node2Pos = node.pos
          @routes[index].geometry.vertices[2 * @curIndex[index]]     = new THREE.Vector3(nodePos[0], nodePos[1], nodePos[2])
          @routes[index].geometry.vertices[2 * @curIndex[index] + 1] = new THREE.Vector3(node2Pos[0], node2Pos[1], node2Pos[2])
          @nodes[index].geometry.vertices[@curIndex[index]]    = new THREE.Vector3(node2Pos[0], node2Pos[1], node2Pos[2])
          # Assign the ID to the vertex, so we can access it later
          @nodes[index].geometry.vertices[@curIndex[index]].id = node.id
          @curIndex[index]++
      @routes[index].geometry.verticesNeedUpdate = true
      @nodes[index].geometry.verticesNeedUpdate = true


    @lastNodePosition = @model.Route.getActiveNodePos()

  setActiveNodePosition : (position) =>
    @lastNodePosition = position
    #@updateRoute()

  getMeshes : =>
    result = []
    for i in [0..@ids.length]
      result = result.concat(@routes[i])
      result = result.concat(@nodes[i])
    return result

  # Looks for the Active Point in Model.Route and adds it to
  # the Skeleton View
  setWaypoint : =>
    curGlobalPos = @flycam.getGlobalPos()
    activePlane  = @flycam.getActivePlane()
    zoomFactor   = @flycam.getPlaneScalingFactor activePlane
    position     = @model.Route.getActiveNodePos()
    typeNumber   = @model.Route.getActiveNodeType()
    id           = @model.Route.getActiveNodeId()
    index        = @getIndexFromTreeId(@model.Route.getTree().treeId)

    #if typeNumber == 0
      # calculate the global position of the rightclick
    #  switch activePlane
    #    when PLANE_XY then position = [curGlobalPos[0] - (@curWidth/2 - position[0])/@x*zoomFactor, curGlobalPos[1] - (@curWidth/2 - position[1])/@x*zoomFactor, curGlobalPos[2]]
    #    when PLANE_YZ then position = [curGlobalPos[0], curGlobalPos[1] - (@curWidth/2 - position[1])/@x*zoomFactor, curGlobalPos[2] - (@curWidth/2 - position[0])/@x*zoomFactor]
    #    when PLANE_XZ then position = [curGlobalPos[0] - (@curWidth/2 - position[0])/@x*zoomFactor, curGlobalPos[1], curGlobalPos[2] - (@curWidth/2 - position[1])/@x*zoomFactor]
      
    unless @curIndex[index]
      @curIndex[index] = 0
      @lastNodePosition = position

    if @curIndex[index] < @maxRouteLen

    #PERFORMANCE TEST
    #for k in [0...@maxRouteLen] 
      #@curIndex = k
      #position[0] = Math.random() * 5000
      #position[1] = Math.random() * 5000
      #position[2] = Math.random() * 5000

      @routes[index].geometry.vertices[2 * @curIndex[index]] = new THREE.Vector3(@lastNodePosition[0], @lastNodePosition[1], @lastNodePosition[2])
      @routes[index].geometry.vertices[2 * @curIndex[index] + 1] = new THREE.Vector3(position[0], position[1], position[2])
      @nodes[index].geometry.vertices[@curIndex[index]] = new THREE.Vector3(position[0], position[1], position[2])
      # Assign the ID to the vertex, so we can access it later
      @nodes[index].geometry.vertices[@curIndex[index]].id = id

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
    
      @lastNodePosition = position
      @curIndex[index]++
      @flycam.hasChanged = true
      
  getIndexFromTreeId : (treeId) ->
    unless treeId
      treeId = @model.Route.getTree().treeId
    for i in [0..@ids.length]
      if @ids[i] == treeId
        return i
    return null
