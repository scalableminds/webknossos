### define
jquery : $
underscore : _
./controller/cameracontroller : CameraController
./controller/scenecontroller : SceneController
./model : Model
./model/dimensions : DimensionsHelper
./view : View
./view/gui : Gui
./model/flycam : Flycam
../libs/event_mixin : EventMixin
../libs/input : Input
###

PLANE_XY         = Dimensions.PLANE_XY
PLANE_YZ         = Dimensions.PLANE_YZ
PLANE_XZ         = Dimensions.PLANE_XZ
VIEW_3D          = Dimensions.VIEW_3D
TYPE_USUAL       = 0
TYPE_BRANCH      = 1
VIEWPORT_WIDTH   = 380
WIDTH            = 384
TEXTURE_SIZE     = 512
TEXTURE_SIZE_P   = 9


class Controller

  constructor : ->

    _.extend(@, new EventMixin())
    @fullScreen = false

    @model = new Model()

    @model.initialize(TEXTURE_SIZE_P, VIEWPORT_WIDTH).done =>

      @flycam = @model.flycam
      @view  = new View(@model, @flycam)

      @view.drawTree(@model.route.getTree())

      # initialize Camera Controller
      @cameraController = new CameraController(@view.getCameras(), @view.getLights(), @flycam, @model)

      @canvasesAndNav = $("#main")[0]

      @prevControls = $('#prevControls')
      @prevControls.addClass("btn-group")
      values        = ["XY Plane", "YZ Plane", "XZ Plane", "3D View"]
      callbacks     = [@cameraController.changePrevXY, @cameraController.changePrevYZ,
                        @cameraController.changePrevXZ, @cameraController.changePrevSV]
      buttons       = new Array(4)
    
      for i in [VIEW_3D, PLANE_XY, PLANE_YZ, PLANE_XZ]

        buttons[i] = $("<input>", type : "button", class : "btn btn-small", value : values[i])
        buttons[i].on("click", callbacks[i])
        @prevControls.append(buttons[i])

      @view.createKeyboardCommandOverlay()

      @sceneController = new SceneController(@model.binary.cube.upperBoundary, @flycam, @model)

      meshes = @sceneController.getMeshes()
      
      for mesh in meshes
        @view.addGeometry(mesh)

      @view.on
        render : => @render()
        renderCam : (id, event) => @sceneController.updateSceneForCam(id)
        abstractTreeClick : (id) => @setActiveNode(id, true, false)

      @sceneController.skeleton.on
        newGeometries : (list, event) =>
          for geometry in list
            @view.addGeometry(geometry)
        removeGeometries : (list, event) =>
          for geometry in list
            @view.removeGeometry(geometry)

      @gui = new Gui($("#optionswindow"), @model, @sceneController, @cameraController, @flycam)
      @gui.on
        deleteActiveNode : @deleteActiveNode
        createNewTree : @createNewTree
        setActiveTree : (id) => @setActiveTree(id)
        setActiveNode : (id) => @setActiveNode(id, false) # not centered
        deleteActiveTree : @deleteActiveTree
      @gui.update()

      @flycam.setGlobalPos(@model.route.data.editPosition)
      @flycam.setZoomSteps(@model.user.zoomXY, @model.user.zoomYZ, @model.user.zoomXZ)
      @flycam.setQuality(@model.user.quality)

      @model.binary.queue.set4Bit(@model.user.fourBit)
      @model.binary.updateLookupTable(@gui.settings.brightness, @gui.settings.contrast)

      @initMouse()
      @initKeyboard()

      @cameraController.changePrevSV()
      @cameraController.setRouteClippingDistance @model.user.routeClippingDistance
      @sceneController.setRouteClippingDistance @model.user.routeClippingDistance
      @sceneController.setDisplayCrosshair @model.user.displayCrosshair
      @sceneController.setInterpolation @model.user.interpolation
      @sceneController.setDisplaySV PLANE_XY, @model.user.displayPreviewXY
      @sceneController.setDisplaySV PLANE_YZ, @model.user.displayPreviewYZ
      @sceneController.setDisplaySV PLANE_XZ, @model.user.displayPreviewXZ
      @sceneController.skeleton.setDisplaySpheres @model.user.nodesAsSpheres


  initMouse : ->

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault()
      return

    for planeId in ["xy", "yz", "xz"]
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

    new Input.Mouse($("#skeletonview"),
      leftDownMove : (delta) => 
        @cameraController.movePrevX(delta.x * @model.user.mouseInversionX)
        @cameraController.movePrevY(delta.y * @model.user.mouseInversionX)
      scroll : @cameraController.zoomPrev
      leftClick : @onPreviewClick
    )


  initKeyboard : ->
    
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or event.which == 18 or 37 <= event.which <= 40) and !$(":focus").length
      return

    new Input.Keyboard(

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
    
    new Input.KeyboardNoLoop(

      #View
      "q" : => @toggleFullScreen()
      "t" : => @view.toggleTheme()
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

      #Delete active node
      "delete" : => @deleteActiveNode()

      "c" : => @createNewTree()

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


  render : ->

    @model.binary.ping(@flycam.getGlobalPos(), {zoomStep: @flycam.getIntegerZoomSteps(), area: [@flycam.getArea(PLANE_XY),
                        @flycam.getArea(PLANE_YZ), @flycam.getArea(PLANE_XZ)], activePlane: @flycam.getActivePlane()})
    @model.route.globalPosition = @flycam.getGlobalPos()
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

  toggleFullScreen : =>
    if @fullScreen
      cancelFullscreen = document.webkitCancelFullScreen or document.mozCancelFullScreen or document.cancelFullScreen
      @fullScreen = false
      if cancelFullscreen
        cancelFullscreen.call(document)
    else
      body = $("body")[0]
      requestFullscreen = body.webkitRequestFullScreen or body.mozRequestFullScreen or body.requestFullScreen
      @fullScreen = true
      if requestFullscreen
        requestFullscreen.call(body, body.ALLOW_KEYBOARD_INPUT)


  ########### Click callbacks
  
  setWaypoint : (relativePosition, typeNumber) =>
    curGlobalPos  = @flycam.getGlobalPos()
    zoomFactor    = @flycam.getPlaneScalingFactor @flycam.getActivePlane()
    activeNodePos = @model.route.getActiveNodePos()
    scaleFactor   = @view.scaleFactor
    planeRatio    = @model.scaleInfo.baseVoxelFactors
    switch @flycam.getActivePlane()
      when PLANE_XY then position = [curGlobalPos[0] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*planeRatio[0]*zoomFactor, curGlobalPos[1] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*planeRatio[1]*zoomFactor, curGlobalPos[2]]
      when PLANE_YZ then position = [curGlobalPos[0], curGlobalPos[1] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*planeRatio[1]*zoomFactor, curGlobalPos[2] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*planeRatio[2]*zoomFactor]
      when PLANE_XZ then position = [curGlobalPos[0] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*planeRatio[0]*zoomFactor, curGlobalPos[1], curGlobalPos[2] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*planeRatio[2]*zoomFactor]
    # set the new trace direction
    if activeNodePos
      p = [position[0] - activeNodePos[0], position[1] - activeNodePos[1], position[2] - activeNodePos[2]]
      @flycam.setDirection(p)
    @addNode(position)

  onPreviewClick : (position, shiftPressed) =>
    @onClick(position, VIEW_3D, shiftPressed)

  onPlaneClick : (position, shiftPressed) =>
    plane = @flycam.getActivePlane()
    @onClick(position, plane, shiftPressed)

  onClick : (position, plane, shiftPressed) =>
    scaleFactor = @view.scaleFactor
    camera      = @view.getCameras()[plane]
    # vector with direction from camera position to click position
    vector = new THREE.Vector3((position[0] / (384 * scaleFactor) ) * 2 - 1, - (position[1] / (384 * scaleFactor)) * 2 + 1, 0.5)
    
    # create a ray with the direction of this vector, set ray threshold depending on the zoom of the 3D-view
    projector = new THREE.Projector()
    ray = projector.pickingRay(vector, camera)
    ray.threshold = @flycam.getRayThreshold(plane)

    ray.__scalingFactors = @model.scaleInfo.nmPerVoxel
 
    # identify clicked object
    intersects = ray.intersectObjects(@sceneController.skeleton.nodes)
    #if intersects.length > 0 and intersects[0].distance >= 0
    for intersect in intersects

      index = intersect.index
      nodeID = intersect.object.geometry.nodeIDs.getAllElements()[index]

      posArray = intersect.object.geometry.__vertexArray
      intersectsCoord = [posArray[3 * index], posArray[3 * index + 1], posArray[3 * index + 2]]
      globalPos = @flycam.getGlobalPos()

      # make sure you can't click nodes, that are clipped away (one can't see)
      ind = Dimensions.getIndices(plane)
      if plane == VIEW_3D or (Math.abs(globalPos[ind[2]] - intersectsCoord[ind[2]]) < @cameraController.getRouteClippingDistance(ind[2])+1)

        # set the active Node to the one that has the ID stored in the vertex
        # center the node if click was in 3d-view
        centered = plane == VIEW_3D
        @setActiveNode(nodeID, centered, shiftPressed)
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
      @flycam.setGlobalPos(position)

  deleteActiveNode : =>
    @model.route.deleteActiveNode()

  createNewTree : =>
    @model.route.createNewTree()

  setActiveTree : (treeId) =>
    @model.route.setActiveTree(treeId)

  deleteActiveTree : =>
    @model.route.deleteTree(true)

  ########### Input Properties

  #Customize Options
  setMoveValue : (value) =>
    @model.user.moveValue = (Number) value
    @model.user.push()

  setRotateValue : (value) =>
    @model.user.rotateValue = (Number) value 
    @model.user.push()   

  setScaleValue : (value) =>
    @model.user.scaleValue = (Number) value  
    @model.user.push()         

  setMouseRotateValue : (value) =>
    @model.user.mouseRotateValue = (Number) value
    @model.user.push()             
