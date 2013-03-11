### define
jquery : $
underscore : _
./camera_controller : CameraController
./scene_controller : SceneController
../model/dimensions : Dimensions
libs/event_mixin : EventMixin
libs/input : Input
../view/plane_view : PlaneView
libs/threejs/TrackballControls : TrackballControls
###

PLANE_XY         = Dimensions.PLANE_XY
PLANE_YZ         = Dimensions.PLANE_YZ
PLANE_XZ         = Dimensions.PLANE_XZ
VIEW_3D          = Dimensions.VIEW_3D
TYPE_USUAL       = 0
TYPE_BRANCH      = 1
WIDTH            = 384


class PlaneController

  bindings : []
  model : null
  view : null
  gui : null

  input :
    skeletonMouse : null
    planeMouse : null
    keyboard : null
    keyboardNoLoop : null

    unbind : ->
      #@skeletonMouse?.unbind()
      #@planeMouse?.unbind()
      @keyboard?.unbind()
      @keyboardNoLoop?.unbind()


  constructor : (@model, stats, @gui ) ->

    _.extend(@, new EventMixin())

    @flycam = @model.flycam
    @view  = new PlaneView(@model, @flycam, stats)

    # initialize Camera Controller
    @cameraController = new CameraController(@view.getCameras(), @view.getLights(), @flycam, @model)

    @canvasesAndNav = $("#main")[0]

    @prevControls = $('#prevControls')
    @prevControls.addClass("btn-group")

    buttons = [
        name : "3D View"
        callback : @cameraController.changePrevSV
      ,
        name : "XY Plane"
        callback : @cameraController.changePrevXY
        color : "#f00"
      ,
        name : "YZ Plane"
        callback : @cameraController.changePrevYZ
        color : "#00f"
      ,
        name : "XZ Plane"
        callback : @cameraController.changePrevXZ
        color : "#0f0"
    ]

    for button in buttons

      button.control = @prevControls.append(
        $("<button>", type : "button", class : "btn btn-small")
          .html("#{if button.color then "<span style=\"background: #{button.color}\"></span>" else ""}#{button.name}")
          .on("click", button.callback)
      )    

    @sceneController = new SceneController(@model.binary.cube.upperBoundary, @flycam, @model)

    meshes = @sceneController.getMeshes()
    
    for mesh in meshes
      @view.addGeometry(mesh)

    @flycam.setPosition(@model.route.data.editPosition)
    @flycam.setZoomSteps(@model.user.zoomXY, @model.user.zoomYZ, @model.user.zoomXZ)
    @flycam.setQuality(@model.user.quality)

    @cameraController.changePrevSV()
    @cameraController.setRouteClippingDistance @model.user.routeClippingDistance
    @sceneController.setRouteClippingDistance @model.user.routeClippingDistance
    @sceneController.setDisplayCrosshair @model.user.displayCrosshair
    @sceneController.setInterpolation @model.user.interpolation
    @sceneController.setDisplaySV PLANE_XY, @model.user.displayPreviewXY
    @sceneController.setDisplaySV PLANE_YZ, @model.user.displayPreviewYZ
    @sceneController.setDisplaySV PLANE_XZ, @model.user.displayPreviewXZ
    @sceneController.skeleton.setDisplaySpheres @model.user.nodesAsSpheres

    @initMouse()
    @bind()
    @start()

    # initialize comments
    @model.route.updateComments()


  initMouse : ->

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault()
      return

    $("#tab-comments").on "click", "a[data-nodeid]", (event) =>
      event.preventDefault()
      @setActiveNode($(event.target).data("nodeid"), true, false)

    for planeId in ["xy", "yz", "xz"]
      #@input.planeMouse = new Input.Mouse($("#plane#{planeId}"),
      new Input.Mouse($("#plane#{planeId}"),
        over : @view["setActivePlane#{planeId.toUpperCase()}"]
        leftDownMove : (delta) => 
          @move [
            delta.x * @model.user.mouseInversionX / @view.scaleFactor
            delta.y * @model.user.mouseInversionX / @view.scaleFactor
            0
          ]
        scroll : @scroll
        leftClick : @onPlaneClick
        rightClick : @setWaypoint
      )

    #@input.skeletonMouse = new Input.Mouse($("#skeletonview"),
    new Input.Mouse($("#skeletonview"),
      leftDownMove : (delta) => 
        @cameraController.movePrevX(delta.x * @model.user.mouseInversionX)
        @cameraController.movePrevY(delta.y * @model.user.mouseInversionX)
      scroll : @cameraController.zoomPrev
      leftClick : @onPreviewClick
    )

    target = document.getElementById("skeletonview")
    @controls = new THREE.TrackballControls(@view.getCameras()[VIEW_3D],
                                      target, => @flycam.hasChanged = true )
    
    @controls.noZoom = true
    @controls.noPan = true
    #@controls.noRotate = true

    @controls.target.set(
      @model.scaleInfo.voxelToNm(
        @flycam.getPosition()
      )...
    )

    @flycam.on({
      positionChanged : (position) =>
        @controls.setTarget(
          new THREE.Vector3(
            @model.scaleInfo.voxelToNm(
              position
            )...
          )
        )
        #@controls.update()
        #@controls.reset()
      })


  initKeyboard : ->
    
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or event.which == 18 or 37 <= event.which <= 40) and !$(":focus").length
      return

    @input.keyboard = new Input.Keyboard(

      #ScaleTrianglesPlane
      "l" : => @view.scaleTrianglesPlane(-@model.user.scaleValue)
      "k" : => @view.scaleTrianglesPlane( @model.user.scaleValue)

      #Move
      "left"  : => @moveX(-@model.user.moveValue)
      "right" : => @moveX( @model.user.moveValue)
      "up"    : => @moveY(-@model.user.moveValue)
      "down"  : => @moveY( @model.user.moveValue)

      #misc keys
      # TODO: what does this? I removed it, I need the key.
      #"n" : => Helper.toggle()
      #"ctr + s"       : => @model.route.pushImpl()
    )
    
    @input.keyboardNoLoop = new Input.KeyboardNoLoop(

      #View     
      "1" : =>
        @sceneController.toggleSkeletonVisibility()
        # Show warning, if this is the first time to use
        # this function for this user
        if @model.user.firstVisToggle
          @view.showFirstVisToggle()
          @model.user.firstVisToggle = false
          @model.user.push()

      #Branches
      "b" : => @pushBranch()
      "j" : => @popBranch() 

      "s" : @centerActiveNode

      #Zoom in/out
      "i" : => @zoomIn()
      "o" : => @zoomOut()

      #Comments
      "n" : => @setActiveNode(@model.route.nextCommentNodeID(false), false)
      "p" : => @setActiveNode(@model.route.nextCommentNodeID(true), false)

      #Move
      "space" : (first) => @moveZ( @model.user.moveValue, first)
      "f" : (first) => @moveZ( @model.user.moveValue, first)
      "d" : (first) => @moveZ( - @model.user.moveValue, first)
      "shift + f" : (first) => @moveZ( @model.user.moveValue * 5, first)
      "shift + d" : (first) => @moveZ( - @model.user.moveValue * 5, first)

      "shift + space" : (first) => @moveZ(-@model.user.moveValue, first)
      "ctrl + space" : (first) => @moveZ(-@model.user.moveValue, first)
    )


  start : ->

    @initKeyboard()
    @view.start()


  stop : ->

    @input.keyboard.unbind()
    @input.keyboardNoLoop.unbind()
    @view.stop()


  bind : ->

    @view.bind()

    @view.on
      render : => @render()
      renderCam : (id, event) => @sceneController.updateSceneForCam(id)

    @sceneController.skeleton.on
      newGeometries : (list, event) =>
        for geometry in list
          @view.addGeometry(geometry)
      removeGeometries : (list, event) =>
        for geometry in list
          @view.removeGeometry(geometry)    


  render : ->

    @model.binary.ping(@flycam.getPosition(), {zoomStep: @flycam.getIntegerZoomSteps(), area: [@flycam.getArea(PLANE_XY),
                        @flycam.getArea(PLANE_YZ), @flycam.getArea(PLANE_XZ)], activePlane: @flycam.getActivePlane()})
    @model.route.globalPosition = @flycam.getPosition()
    @cameraController.update()
    @sceneController.update()
    @model.route.rendered()

  move : (v) => @flycam.moveActivePlane(v)

  moveX : (x) => @move([x, 0, 0])
  moveY : (y) => @move([0, y, 0])
  moveZ : (z, first) =>
    if(first)
      activePlane = @flycam.getActivePlane()
      @flycam.move(Dimensions.transDim(
        [0, 0, (if z < 0 then -1 else 1) << @flycam.getIntegerZoomStep(activePlane)],
        activePlane), activePlane)
    else
      @move([0, 0, z])

  zoomIn : =>
    @cameraController.zoomIn()
    # Remember Zoom Steps
    @model.user.zoomXY = @flycam.getZoomStep(PLANE_XY)
    @model.user.zoomYZ = @flycam.getZoomStep(PLANE_YZ)
    @model.user.zoomXZ = @flycam.getZoomStep(PLANE_XZ)
    @model.user.push()

  zoomOut : =>
    @cameraController.zoomOut()
    # Remember Zoom Steps
    @model.user.zoomXY = @flycam.getZoomStep(PLANE_XY)
    @model.user.zoomYZ = @flycam.getZoomStep(PLANE_YZ)
    @model.user.zoomXZ = @flycam.getZoomStep(PLANE_XZ)
    @model.user.push()

  setNodeRadius : (delta) =>
    lastRadius = @model.route.getActiveNodeRadius()
    radius = lastRadius + (lastRadius/20 * delta) #achieve logarithmic change behaviour
    @model.route.setActiveNodeRadius(radius)

  scroll : (delta, type) =>
    switch type
      when null then @moveZ(delta)
      # when "shift" then @setNodeRadius(delta)
      when "alt"
        if delta > 0
          @zoomIn()
        else
          @zoomOut()


  ########### Click callbacks
  
  setWaypoint : (relativePosition, typeNumber) =>
    curGlobalPos  = @flycam.getPosition()
    zoomFactor    = @flycam.getPlaneScalingFactor @flycam.getActivePlane()
    activeNodePos = @model.route.getActiveNodePos()
    scaleFactor   = @view.scaleFactor
    planeRatio    = @model.scaleInfo.baseVoxelFactors
    position = switch @flycam.getActivePlane()
      when PLANE_XY 
        [
          curGlobalPos[0] - (WIDTH * scaleFactor / 2 - relativePosition[0]) / scaleFactor * planeRatio[0] * zoomFactor, 
          curGlobalPos[1] - (WIDTH * scaleFactor / 2 - relativePosition[1]) / scaleFactor * planeRatio[1] * zoomFactor, 
          curGlobalPos[2]
        ]
      when PLANE_YZ 
        [
          curGlobalPos[0], 
          curGlobalPos[1] - (WIDTH * scaleFactor / 2 - relativePosition[1]) / scaleFactor * planeRatio[1] * zoomFactor, 
          curGlobalPos[2] - (WIDTH * scaleFactor / 2 - relativePosition[0]) / scaleFactor * planeRatio[2] * zoomFactor
        ]
      when PLANE_XZ 
        [
          curGlobalPos[0] - (WIDTH * scaleFactor / 2 - relativePosition[0]) / scaleFactor * planeRatio[0] * zoomFactor, 
          curGlobalPos[1], 
          curGlobalPos[2] - (WIDTH * scaleFactor / 2 - relativePosition[1]) / scaleFactor * planeRatio[2] * zoomFactor
        ]
    # set the new trace direction
    if activeNodePos
      @flycam.setDirection([
        position[0] - activeNodePos[0], 
        position[1] - activeNodePos[1], 
        position[2] - activeNodePos[2]
      ])
    @addNode(position)

  onPreviewClick : (position, shiftAltPressed) =>
    @onClick(position, VIEW_3D, shiftAltPressed)

  onPlaneClick : (position, shiftAltPressed) =>
    plane = @flycam.getActivePlane()
    @onClick(position, plane, shiftAltPressed)

  onClick : (position, plane, shiftAltPressed) =>
    scaleFactor = @view.scaleFactor
    camera      = @view.getCameras()[plane]
    # vector with direction from camera position to click position
    vector = new THREE.Vector3((position[0] / (384 * scaleFactor) ) * 2 - 1, - (position[1] / (384 * scaleFactor)) * 2 + 1, 0.5)
    
    # create a ray with the direction of this vector, set ray threshold depending on the zoom of the 3D-view
    projector = new THREE.Projector()
    raycaster = projector.pickingRay(vector, camera)
    raycaster.ray.threshold = @flycam.getRayThreshold(plane)

    raycaster.ray.__scalingFactors = @model.scaleInfo.nmPerVoxel
 
    # identify clicked object
    intersects = raycaster.intersectObjects(@sceneController.skeleton.nodes)
    #if intersects.length > 0 and intersects[0].distance >= 0
    for intersect in intersects
      
      index = intersect.index
      nodeID = intersect.object.geometry.nodeIDs.getAllElements()[index]

      posArray = intersect.object.geometry.__vertexArray
      intersectsCoord = [posArray[3 * index], posArray[3 * index + 1], posArray[3 * index + 2]]
      globalPos = @flycam.getPosition()

      # make sure you can't click nodes, that are clipped away (one can't see)
      ind = Dimensions.getIndices(plane)
      if plane == VIEW_3D or (Math.abs(globalPos[ind[2]] - intersectsCoord[ind[2]]) < @cameraController.getRouteClippingDistance(ind[2])+1)

        # set the active Node to the one that has the ID stored in the vertex
        # center the node if click was in 3d-view
        centered = plane == VIEW_3D
        @setActiveNode(nodeID, centered, shiftAltPressed)
        break

  ########### Model Interaction

  addNode : (position) =>
    if @model.user.newNodeNewTree == true
      @createNewTree()
      @model.route.one("rendered", =>
        @model.route.one("rendered", =>
          @model.route.addNode(position, TYPE_USUAL)))
    else
      @model.route.addNode(position, TYPE_USUAL)

  pushBranch : =>
    @model.route.pushBranch()

  popBranch : =>
    _.defer => @model.route.popBranch().done((id) => 
      @setActiveNode(id, true)
    )

  setActiveNode : (nodeId, centered, mergeTree) =>
    @model.route.setActiveNode(nodeId, mergeTree)
    if centered
      @centerActiveNode()

  centerActiveNode : =>
    position = @model.route.getActiveNodePos()
    if position
      @flycam.setPosition(position)

  deleteActiveNode : =>
    @model.route.deleteActiveNode()

  createNewTree : =>
    @model.route.createNewTree()
