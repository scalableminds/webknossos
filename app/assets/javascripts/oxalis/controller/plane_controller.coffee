### define
jquery : $
underscore : _
./camera_controller : CameraController
./scene_controller : SceneController
../model/dimensions : Dimensions
libs/event_mixin : EventMixin
libs/input : Input
../view/plane_view : PlaneView
../constants : constants
libs/threejs/TrackballControls : TrackballControls
###

class PlaneController

  bindings : []
  model : null
  view : null
  gui : null

  input :
    mouseControllers : []
    keyboard : null
    keyboardNoLoop : null
    keyboardLoopDelayed : null

    unbind : ->
      for mouse in @mouseControllers
        mouse.unbind()
      @mouseControllers = []
      @keyboard?.unbind()
      @keyboardNoLoop?.unbind()
      @keyboardLoopDelayed?.unbind()


  constructor : (@model, stats, @gui, renderer, scene) ->

    _.extend(@, new EventMixin())

    @flycam = @model.flycam
    @flycam.setPosition(@model.route.data.editPosition)
    @flycam.setZoomStep(@model.user.zoom)
    @flycam.setQuality(@model.user.quality)

    @view  = new PlaneView(@model, @flycam, stats, renderer, scene)

    # initialize Camera Controller
    @cameraController = new CameraController(@view.getCameras(), @view.getLights(), @flycam, @model)

    @canvasesAndNav = $("#main")[0]

    @prevControls = $('#prevControls')
    @prevControls.addClass("btn-group")

    buttons = [
        name : "3D"
        callback : @cameraController.changePrevSV
      ,
        name : "XY"
        callback : @cameraController.changePrevXY
        color : "#f00"
      ,
        name : "YZ"
        callback : @cameraController.changePrevYZ
        color : "#00f"
      ,
        name : "XZ"
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

    @model.user.triggerAll()

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault()
      return

    @initTrackballControls()
    @bind()
    @start()


  initMouse : ->

    for planeId in ["xy", "yz", "xz"]
      @input.mouseControllers.push( new Input.Mouse($("#plane#{planeId}"),
        over : @view["setActivePlane#{planeId.toUpperCase()}"]
        leftDownMove : (delta) => 
          @flycam.moveActivePlane [
            delta.x * @model.user.getMouseInversionX() / @view.scaleFactor
            delta.y * @model.user.getMouseInversionY() / @view.scaleFactor
            0
          ]
        scroll : @scroll
        leftClick : @onClick
        rightClick : @setWaypoint
      ) )

    @input.mouseControllers.push( new Input.Mouse($("#skeletonview"),
      leftDownMove : (delta) => 
        @cameraController.movePrevX(delta.x * @model.user.getMouseInversionX())
        @cameraController.movePrevY(delta.y * @model.user.getMouseInversionY())
      scroll : (value) =>
        @cameraController.zoomPrev(value,
          @input.mouseControllers[constants.VIEW_3D].position,
          @view.curWidth)
      leftClick : @onPreviewClick
    ) )


  initTrackballControls : ->

    view = $("#skeletonview")[0]
    pos = @model.scaleInfo.voxelToNm(@flycam.getPosition())
    @controls = new THREE.TrackballControls(
      @view.getCameras()[constants.VIEW_3D],
      view, 
      new THREE.Vector3(pos...), 
      => @flycam.hasChanged = true )
    
    @controls.noZoom = true
    @controls.noPan = true

    @controls.target.set(
      @model.scaleInfo.voxelToNm(@flycam.getPosition())...)

    @flycam.on
      positionChanged : (position) =>
        @controls.setTarget(
          new THREE.Vector3(@model.scaleInfo.voxelToNm(position)...))

    @cameraController.on
      cameraPositionChanged : =>
        @controls.update()


  initKeyboard : ->
    
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or event.which == 18 or 37 <= event.which <= 40) and !$(":focus").length
      return

    getVoxelOffset  = (timeFactor) =>
      return @model.user.moveValue * timeFactor / @model.scaleInfo.baseVoxel / constants.FPS

    @input.keyboard = new Input.Keyboard(

      #ScaleTrianglesPlane
      "l" : (timeFactor) => @scaleTrianglesPlane(-@model.user.scaleValue * timeFactor )
      "k" : (timeFactor) => @scaleTrianglesPlane( @model.user.scaleValue * timeFactor )

      #Move
      "left"  : (timeFactor) => @moveX(-getVoxelOffset(timeFactor))
      "right" : (timeFactor) => @moveX( getVoxelOffset(timeFactor))
      "up"    : (timeFactor) => @moveY(-getVoxelOffset(timeFactor))
      "down"  : (timeFactor) => @moveY( getVoxelOffset(timeFactor))

      #misc keys
      # TODO: what does this? I removed it, I need the key.
      #"n" : => Helper.toggle()
      #"ctr + s"       : => @model.route.pushImpl()
    )

    @input.keyboardLoopDelayed = new Input.Keyboard(

      "space"         : (timeFactor, first) => @moveZ( getVoxelOffset(timeFactor)    , first)
      "f"             : (timeFactor, first) => @moveZ( getVoxelOffset(timeFactor)    , first)
      "d"             : (timeFactor, first) => @moveZ(-getVoxelOffset(timeFactor)    , first)
      "shift + f"     : (timeFactor, first) => @moveZ( getVoxelOffset(timeFactor) * 5, first)
      "shift + d"     : (timeFactor, first) => @moveZ(-getVoxelOffset(timeFactor) * 5, first)
    
      "shift + space" : (timeFactor, first) => @moveZ(-getVoxelOffset(timeFactor)    , first)
      "ctrl + space"  : (timeFactor, first) => @moveZ(-getVoxelOffset(timeFactor)    , first)
    
    , @model.user.keyboardDelay)

    @model.user.on({
      keyboardDelayChanged : (value) => @input.keyboardLoopDelayed.delay = value
      })
    
    @input.keyboardNoLoop = new Input.KeyboardNoLoop(

      #Branches
      "b" : => @pushBranch()
      "j" : => @popBranch() 

      "s" : @centerActiveNode

      #Zoom in/out
      "i" : => @zoomIn(false)
      "o" : => @zoomOut(false)

      #Change move value
      "h" : => @changeMoveValue(25)
      "g" : => @changeMoveValue(-25)

      #Comments
      "n" : => @setActiveNode(@model.route.nextCommentNodeID(false), false)
      "p" : => @setActiveNode(@model.route.nextCommentNodeID(true), false)
    )


  init : ->

    @cameraController.setRouteClippingDistance @model.user.routeClippingDistance
    @sceneController.setRouteClippingDistance @model.user.routeClippingDistance


  start : ->

    @initKeyboard()
    @init()
    @initMouse()
    @sceneController.start()
    @view.start()


  stop : ->

    @input.unbind()
    @view.stop()
    @sceneController.stop()


  bind : ->

    @view.bind()

    @view.on
      render : => @render()
      finishedRender : => @model.route.rendered()
      renderCam : (id, event) => @sceneController.updateSceneForCam(id)

    @sceneController.skeleton.on
      newGeometries : (list, event) =>
        for geometry in list
          @view.addGeometry(geometry)
      removeGeometries : (list, event) =>
        for geometry in list
          @view.removeGeometry(geometry)    


  render : ->

    @model.binary.ping(@flycam.getPosition(), {zoomStep: @flycam.getIntegerZoomStep(), area: [@flycam.getArea(constants.PLANE_XY),
                        @flycam.getArea(constants.PLANE_YZ), @flycam.getArea(constants.PLANE_XZ)], activePlane: @flycam.getActivePlane()})
    @model.route.globalPosition = @flycam.getPosition()
    @cameraController.update()
    @sceneController.update()

  moveX : (x) => @flycam.moveActivePlane([x, 0, 0])
  moveY : (y) => @flycam.moveActivePlane([0, y, 0])
  moveZ : (z, first) =>
    if(first)
      activePlane = @flycam.getActivePlane()
      @flycam.move(Dimensions.transDim(
        [0, 0, (if z < 0 then -1 else 1) << @flycam.getIntegerZoomStep()],
        activePlane), activePlane)
    else
      @flycam.moveActivePlane([0, 0, z], false)

  zoomIn : (zoomToMouse) =>
    if zoomToMouse
      @zoomPos = @getMousePosition()
    @cameraController.zoom(@flycam.getZoomStep() - constants.ZOOM_DIFF)
    @model.user.setValue("zoom", @flycam.getPlaneScalingFactor())
    if zoomToMouse
      @finishZoom()

  zoomOut : (zoomToMouse) =>
    if zoomToMouse
      @zoomPos = @getMousePosition()
    @cameraController.zoom(@flycam.getZoomStep() + constants.ZOOM_DIFF)
    @model.user.setValue("zoom", @flycam.getPlaneScalingFactor())
    if zoomToMouse
      @finishZoom()

  finishZoom : =>
    
    # Move the plane so that the mouse is at the same position as
    # before the zoom
    if @isMouseOver()
      mousePos = @getMousePosition()
      moveVector = [@zoomPos[0] - mousePos[0],
                    @zoomPos[1] - mousePos[1],
                    @zoomPos[2] - mousePos[2]]
      @flycam.move(moveVector, @flycam.getActivePlane())

  getMousePosition : ->
    activePlane = @flycam.getActivePlane()
    pos = @input.mouseControllers[activePlane].position
    return @calculateGlobalPos([pos.x, pos.y])

  isMouseOver : ->
    activePlane = @flycam.getActivePlane()
    return @input.mouseControllers[activePlane].isMouseOver

  changeMoveValue : (delta) ->
    moveValue = @model.user.moveValue + delta
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue)
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue)

    @model.user.setValue("moveValue", (Number) moveValue)

  scaleTrianglesPlane : (delta) ->
    scale = @model.user.scale + delta
    scale = Math.min(constants.MAX_SCALE, scale)
    scale = Math.max(constants.MIN_SCALE, scale)

    @model.user.setValue("scale", (Number) scale)

  setNodeRadius : (delta) =>
    lastRadius = @model.route.getActiveNodeRadius()
    radius = lastRadius + (lastRadius/20 * delta) #achieve logarithmic change behaviour
    @model.route.setActiveNodeRadius(radius)

  setParticleSize : (delta) =>
    particleSize = @model.user.particleSize + delta
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize)
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize)

    @model.user.setValue("particleSize", (Number) particleSize)

  scroll : (delta, type) =>
    switch type
      when null then @moveZ(delta)
      when "shift" then @setParticleSize(delta)
      when "alt"
        if delta > 0
          @zoomIn(true)
        else
          @zoomOut(true)
 
  toggleSkeletonVisibility : =>
    @sceneController.toggleSkeletonVisibility()
    # Show warning, if this is the first time to use
    # this function for this user
    if @model.user.firstVisToggle
      @view.showFirstVisToggle()
      @model.user.firstVisToggle = false
      @model.user.push()

  toggleInactiveTreeVisibility : =>
    @sceneController.toggleInactiveTreeVisibility()


  ########### Click callbacks
  
  setWaypoint : (relativePosition, ctrlPressed) =>
    activeNode = @model.route.getActiveNode()
    position = @calculateGlobalPos(relativePosition)
    # set the new trace direction
    if activeNode
      @flycam.setDirection([
        position[0] - activeNode.pos[0], 
        position[1] - activeNode.pos[1], 
        position[2] - activeNode.pos[2]
      ])

    @addNode(position, not ctrlPressed)

    # Strg + Rightclick to set new not active branchpoint
    if ctrlPressed and 
      @model.user.newNodeNewTree == false and 
        @model.route.getActiveNodeType() == constants.TYPE_USUAL

      @pushBranch()
      @setActiveNode(activeNode.id)

  calculateGlobalPos : (clickPos) ->
    curGlobalPos  = @flycam.getPosition()
    zoomFactor    = @flycam.getPlaneScalingFactor()
    scaleFactor   = @view.scaleFactor
    planeRatio    = @model.scaleInfo.baseVoxelFactors
    position = switch @flycam.getActivePlane()
      when constants.PLANE_XY 
        [ curGlobalPos[0] - (constants.WIDTH * scaleFactor / 2 - clickPos[0]) / scaleFactor * planeRatio[0] * zoomFactor, 
          curGlobalPos[1] - (constants.WIDTH * scaleFactor / 2 - clickPos[1]) / scaleFactor * planeRatio[1] * zoomFactor, 
          curGlobalPos[2] ]
      when constants.PLANE_YZ 
        [ curGlobalPos[0], 
          curGlobalPos[1] - (constants.WIDTH * scaleFactor / 2 - clickPos[1]) / scaleFactor * planeRatio[1] * zoomFactor, 
          curGlobalPos[2] - (constants.WIDTH * scaleFactor / 2 - clickPos[0]) / scaleFactor * planeRatio[2] * zoomFactor ]
      when constants.PLANE_XZ 
        [ curGlobalPos[0] - (constants.WIDTH * scaleFactor / 2 - clickPos[0]) / scaleFactor * planeRatio[0] * zoomFactor, 
          curGlobalPos[1], 
          curGlobalPos[2] - (constants.WIDTH * scaleFactor / 2 - clickPos[1]) / scaleFactor * planeRatio[2] * zoomFactor ]

  onPreviewClick : (position, shiftPressed, altPressed) =>
    @onClick(position, shiftPressed, altPressed, constants.VIEW_3D)

  onClick : (position, shiftPressed, altPressed, plane) =>

    unless shiftPressed # do nothing
      return
    unless plane?
      plane = @flycam.getActivePlane()

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
      if intersect.object.visible and
        (plane == constants.VIEW_3D or
          (Math.abs(globalPos[ind[2]] - intersectsCoord[ind[2]]) < @cameraController.getRouteClippingDistance(ind[2])+1))

        # set the active Node to the one that has the ID stored in the vertex
        # center the node if click was in 3d-view
        centered = plane == constants.VIEW_3D
        @setActiveNode(nodeID, centered, shiftPressed and altPressed)
        break

  ########### Model Interaction

  addNode : (position, centered) =>
    if @model.user.newNodeNewTree == true
      @createNewTree()
      # make sure the tree was rendered two times before adding nodes,
      # otherwise our buffer optimizations won't work
      @model.route.one("finishedRender", =>
        @model.route.one("finishedRender", =>
          @model.route.addNode(position, constants.TYPE_USUAL))
        @view.draw())
      @view.draw()
    else
      @model.route.addNode(position, constants.TYPE_USUAL, centered)

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
