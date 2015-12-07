### define
jquery : $
underscore : _
mjs : MJS
libs/event_mixin : EventMixin
libs/request : Request
libs/input : Input
../../geometries/arbitrary_plane : ArbitraryPlane
../../geometries/crosshair : Crosshair
../../view/arbitrary_view : ArbitraryView
../../geometries/arbitrary_plane_info : ArbitraryPlaneInfo
../../constants : constants
###

class ArbitraryController

  # See comment in Controller class on general controller architecture.
  #
  # Arbitrary Controller: Responsible for Arbitrary Modes

  WIDTH : 128

  plane : null
  crosshair : null
  cam : null

  fullscreen : false
  lastNodeMatrix : null

  model : null
  view : null

  record : false

  input :
    mouse : null
    keyboard : null
    keyboardNoLoop : null
    keyboardOnce : null

    unbind : ->

      @mouse?.unbind()
      @keyboard?.unbind()
      @keyboardNoLoop?.unbind()
      @keyboardOnce?.unbind()


  constructor : (@model, stats, @gui, @view, @sceneController, @skeletonTracingController) ->

    _.extend(this, new EventMixin())

    @isStarted = false

    @canvas = canvas = $("#render-canvas")

    @cam = @model.flycam3d
    @arbitraryView = new ArbitraryView(canvas, @cam, stats, @view, @model.scaleInfo, @WIDTH)

    @plane = new ArbitraryPlane(@cam, @model, @WIDTH)
    @arbitraryView.addGeometry @plane

    @infoPlane = new ArbitraryPlaneInfo()

    @input = _.extend({}, @input)

    @crosshair = new Crosshair(@cam, model.user.get("crosshairSize"))
    @arbitraryView.addGeometry(@crosshair)

    @model.user.on
      displayCrosshairChanged : (displayCrosshair) =>
        @crosshair.setVisibility(displayCrosshair)

    @bind()
    @arbitraryView.draw()

    @stop()

    # Toggle record
    @setRecord(false)
    $('#trace-mode-trace').on("click", =>
      @setRecord(true)
      $(":focus").blur()
    )
    $('#trace-mode-watch').on("click", =>
      @setRecord(false)
      $(":focus").blur()
    )


  render : (forceUpdate, event) ->

    matrix = @cam.getMatrix()
    for binary in @model.getColorBinaries()
      binary.arbitraryPing(matrix)


  initMouse : ->

    @input.mouse = new Input.Mouse(
      @canvas
      leftDownMove : (delta) =>
        if @mode == constants.MODE_ARBITRARY
          @cam.yaw(
            -delta.x * @model.user.getMouseInversionX() * @model.user.get("mouseRotateValue"),
            true
          )
          @cam.pitch(
            delta.y * @model.user.getMouseInversionY() * @model.user.get("mouseRotateValue"),
            true
          )
        else if @mode == constants.MODE_ARBITRARY_PLANE
          f = @cam.getZoomStep() / (@arbitraryView.width / @WIDTH)
          @cam.move [delta.x * f, delta.y * f, 0]
      scroll : @scroll
    )


  initKeyboard : ->

    getVoxelOffset  = (timeFactor) =>

      return @model.user.get("moveValue3d") * timeFactor / @model.scaleInfo.baseVoxel / constants.FPS


    @input.keyboard = new Input.Keyboard(

      # Scale plane
      "l"             : (timeFactor) => @arbitraryView.applyScale -@model.user.get("scaleValue")
      "k"             : (timeFactor) => @arbitraryView.applyScale  @model.user.get("scaleValue")

      #Move
      "w"             : (timeFactor) => @cam.move [0, getVoxelOffset(timeFactor), 0]
      "s"             : (timeFactor) => @cam.move [0, -getVoxelOffset(timeFactor), 0]
      "a"             : (timeFactor) => @cam.move [getVoxelOffset(timeFactor), 0, 0]
      "d"             : (timeFactor) => @cam.move [-getVoxelOffset(timeFactor), 0, 0]
      "space"         : (timeFactor) =>
        @cam.move [0, 0, getVoxelOffset(timeFactor)]
        @moved()
      "alt + space"   : (timeFactor) => @cam.move [0, 0, -getVoxelOffset(timeFactor)]

      #Rotate in distance
      "left"          : (timeFactor) => @cam.yaw @model.user.get("rotateValue") * timeFactor, @mode == constants.MODE_ARBITRARY
      "right"         : (timeFactor) => @cam.yaw -@model.user.get("rotateValue") * timeFactor, @mode == constants.MODE_ARBITRARY
      "up"            : (timeFactor) => @cam.pitch -@model.user.get("rotateValue") * timeFactor, @mode == constants.MODE_ARBITRARY
      "down"          : (timeFactor) => @cam.pitch @model.user.get("rotateValue") * timeFactor, @mode == constants.MODE_ARBITRARY

      #Rotate at centre
      "shift + left"  : (timeFactor) => @cam.yaw @model.user.get("rotateValue") * timeFactor
      "shift + right" : (timeFactor) => @cam.yaw -@model.user.get("rotateValue") * timeFactor
      "shift + up"    : (timeFactor) => @cam.pitch @model.user.get("rotateValue") * timeFactor
      "shift + down"  : (timeFactor) => @cam.pitch -@model.user.get("rotateValue") * timeFactor

      #Zoom in/out
      "i"             : (timeFactor) => @cam.zoomIn()
      "o"             : (timeFactor) => @cam.zoomOut()

      #Change move value
      "h"             : (timeFactor) => @changeMoveValue(25)
      "g"             : (timeFactor) => @changeMoveValue(-25)
    )

    @input.keyboardNoLoop = new Input.KeyboardNoLoop(

      "1" : => @skeletonTracingController.toggleSkeletonVisibility()
      "2" : => @sceneController.skeleton.toggleInactiveTreeVisibility()

      #Delete active node
      "delete" : => @model.skeletonTracing.deleteActiveNode()
      "c" : => @model.skeletonTracing.createNewTree()

      #Branches
      "b" : => @pushBranch()
      "j" : => @popBranch()

      #Reset Matrix
      "r" : => @cam.setRotation([0, 0, 0])

      #Recenter active node
      "y" : => @centerActiveNode()

      #Recording of Waypoints
      "z" : =>
        @setRecord(true)
      "u" : =>
        @setRecord(false)
      #Comments
      "n" : => @setActiveNode(@model.skeletonTracing.nextCommentNodeID(false), true)
      "p" : => @setActiveNode(@model.skeletonTracing.nextCommentNodeID(true), true)
    )

    @input.keyboardOnce = new Input.Keyboard(

      #Delete active node and recenter last node
      "shift + space" : =>
        @model.skeletonTracing.deleteActiveNode()
        @centerActiveNode()

    , -1)


  setRecord : (@record) ->

    $('#trace-mode button').removeClass("btn-primary")
    if @record
      $('#trace-mode-trace').addClass("btn-primary")
    else
      $('#trace-mode-watch').addClass("btn-primary")

    @infoPlane.updateInfo(@record)
    if @record
      @setWaypoint()


  init : ->

    @setClippingDistance @model.user.get("clippingDistance")
    @arbitraryView.applyScale(0)


  bind : ->

    @arbitraryView.on "render", (force, event) => @render(force, event)
    @arbitraryView.on "finishedRender", => @model.skeletonTracing.rendered()

    for name, binary of @model.binary
      binary.cube.on "bucketLoaded", => @arbitraryView.draw()

    @model.user.on

      crosshairSizeChanged : (value) =>
        @crosshair.setScale(value)

      sphericalCapRadiusChanged : (value) =>
        @model.flycam3d.distance = value
        @plane.setMode @mode

      clippingDistanceArbitraryChanged : (value) =>
        @setClippingDistance(value)


  start : (@mode) ->

    @stop()

    @plane.setMode @mode

    @initKeyboard()
    @initMouse()
    @arbitraryView.start()
    @init()
    @arbitraryView.draw()

    @isStarted = true


  stop : ->

    if @isStarted
      @input.unbind()

    @arbitraryView.stop()

    @isStarted = false


  scroll : (delta, type) =>

    switch type
      when "shift" then @setParticleSize(delta)


  addNode : (position) =>

    @model.skeletonTracing.addNode(position, constants.TYPE_USUAL, constants.ARBITRARY_VIEW, 0, false)


  setWaypoint : () =>

    unless @record
      return

    position  = @cam.getPosition()
    activeNodePos = @model.skeletonTracing.getActiveNodePos()

    @addNode(position)

  changeMoveValue : (delta) ->

    moveValue = @model.user.get("moveValue3d") + delta
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue)
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue)

    @model.user.set("moveValue3d", (Number) moveValue)


  setParticleSize : (delta) =>

    particleSize = @model.user.get("particleSize") + delta
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize)
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize)

    @model.user.set("particleSize", (Number) particleSize)


  setClippingDistance : (value) =>

    @arbitraryView.setClippingDistance(value)


  pushBranch : ->

    @model.skeletonTracing.pushBranch()


  popBranch : ->

    _.defer => @model.skeletonTracing.popBranch().done((id) =>
      @setActiveNode(id, true)
    )


  centerActiveNode : ->

    activeNode = @model.skeletonTracing.getActiveNode()
    if activeNode
      newPos = activeNode.pos
      parent = activeNode.parent
      while parent
        # obtain last direction
        direction = ([
          activeNode.pos[0] - parent.pos[0],
          activeNode.pos[1] - parent.pos[1],
          activeNode.pos[2] - parent.pos[2]])
        if direction[0] or direction[1] or direction[2]
          break
        parent = parent.parent

      # animate the change to the new position and new rotation (if given)
      curPos = @cam.getPosition()
      curRotation = @cam.getRotation()
      newRotation = @getShortestRotationToDirection(curRotation, direction)
      waypointAnimation = new TWEEN.Tween(
        {x: curPos[0], y: curPos[1], z: curPos[2], rx: curRotation[0], ry: curRotation[1], rz: curRotation[2], cam: @cam, directionChanged: direction})
      waypointAnimation.to(
        {x: newPos[0], y: newPos[1], z: newPos[2], rx: newRotation[0], ry: newRotation[1], rz: newRotation[2]}, 200)
      waypointAnimation.onUpdate( ->
        @cam.setPosition([@x, @y, @z])
        @cam.setRotation([@rx, @ry, @rz]) if @directionChanged
      )
      waypointAnimation.start()

      @cam.update()


  setActiveNode : (nodeId, centered, mergeTree) ->

    @model.skeletonTracing.setActiveNode(nodeId, mergeTree)
    @cam.setPosition @model.skeletonTracing.getActiveNodePos()


  moved : ->

    matrix = @cam.getMatrix()

    unless @lastNodeMatrix?
      @lastNodeMatrix = matrix

    lastNodeMatrix = @lastNodeMatrix

    vector = [
      lastNodeMatrix[12] - matrix[12]
      lastNodeMatrix[13] - matrix[13]
      lastNodeMatrix[14] - matrix[14]
    ]
    vectorLength = MJS.V3.length(vector)

    if vectorLength > 10
      @setWaypoint()
      @lastNodeMatrix = matrix


  getShortestRotationToDirection : (curRotation, direction) ->

    # if there is no direction supplied, don't rotate
    newRotation = curRotation
    if direction
      newRotation = @cam.setDirectionSilent(@model.scaleInfo.voxelToNm(direction))
      for i in [0..2]
        # a rotation about more than 180° is shorter when rotating the other direction
        if newRotation[i] - curRotation[i] >= 180
          newRotation[i] -= 360
        else if newRotation[i] - curRotation[i] <= -180
          newRotation[i] += 360
    return newRotation
