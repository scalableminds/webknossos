app                = require("app")
Backbone           = require("backbone")
$                  = require("jquery")
_                  = require("lodash")
TWEEN              = require("tween.js")
Input              = require("libs/input")
ArbitraryPlane     = require("../../geometries/arbitrary_plane")
Crosshair          = require("../../geometries/crosshair")
ArbitraryView      = require("../../view/arbitrary_view")
ArbitraryPlaneInfo = require("../../geometries/arbitrary_plane_info")
constants          = require("../../constants")
{M4x4, V3}         = require("libs/mjs")


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


  constructor : (@model, @view, @sceneController, @skeletonTracingController) ->

    _.extend(this, Backbone.Events)

    @isStarted = false

    @canvas = canvas = $("#render-canvas")

    @cam = @model.flycam3d
    @arbitraryView = new ArbitraryView(canvas, @cam, @view, @WIDTH)

    @plane = new ArbitraryPlane(@cam, @model, @WIDTH)
    @arbitraryView.addGeometry @plane

    # render HTML element to indicate recording status
    @infoPlane = new ArbitraryPlaneInfo()
    @infoPlane.render()
    $("#render").append(@infoPlane.el)


    @input = _.extend({}, @input)

    @crosshair = new Crosshair(@cam, @model.user.get("crosshairSize"))
    @arbitraryView.addGeometry(@crosshair)

    @listenTo(@model.user, "change:displayCrosshair", (model, value) ->
      @crosshair.setVisibility(value)
    )

    @bindToEvents()
    @arbitraryView.draw()

    @stop()

    @crosshair.setVisibility(@model.user.get("displayCrosshair"))

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

      return @model.user.get("moveValue3d") * timeFactor / app.scaleInfo.baseVoxel / constants.FPS


    @input.keyboard = new Input.Keyboard(

      # KeyboardJS is sensitive to ordering (complex combos first)

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
      "ctrl + space"   : (timeFactor) => @cam.move [0, 0, -getVoxelOffset(timeFactor)]

      #Rotate at centre
      "shift + left"  : (timeFactor) => @cam.yaw @model.user.get("rotateValue") * timeFactor
      "shift + right" : (timeFactor) => @cam.yaw -@model.user.get("rotateValue") * timeFactor
      "shift + up"    : (timeFactor) => @cam.pitch @model.user.get("rotateValue") * timeFactor
      "shift + down"  : (timeFactor) => @cam.pitch -@model.user.get("rotateValue") * timeFactor

      #Rotate in distance
      "left"          : (timeFactor) => @cam.yaw @model.user.get("rotateValue") * timeFactor, @mode == constants.MODE_ARBITRARY
      "right"         : (timeFactor) => @cam.yaw -@model.user.get("rotateValue") * timeFactor, @mode == constants.MODE_ARBITRARY
      "up"            : (timeFactor) => @cam.pitch -@model.user.get("rotateValue") * timeFactor, @mode == constants.MODE_ARBITRARY
      "down"          : (timeFactor) => @cam.pitch @model.user.get("rotateValue") * timeFactor, @mode == constants.MODE_ARBITRARY

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

    @setClippingDistance(@model.user.get("clippingDistanceArbitrary"))
    @arbitraryView.applyScale(0)


  bindToEvents : ->

    @listenTo(@arbitraryView, "render", @render)

    for name, binary of @model.binary
      @listenTo(binary.cube, "bucketLoaded", @arbitraryView.draw)

    @listenTo(@model.user, "change:crosshairSize", (model, value) ->
      @crosshair.setScale(value)
    )
    @listenTo(@model.user, "change:sphericalCapRadius" : (model, value) ->
      @model.flycam3d.distance = value
      @plane.setMode(@mode)
    )
    @listenTo(@model.user, "change:clippingDistanceArbitrary", (model, value) ->
      @setClippingDistance(value)
    )


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


  addNode : (position, rotation) =>

    datasetConfig = @model.get("datasetConfiguration")
    fourBit = if datasetConfig.get("fourBit") then 4 else 8
    interpolation = datasetConfig.get("interpolation")

    @model.skeletonTracing.addNode(position, rotation, constants.TYPE_USUAL, constants.ARBITRARY_VIEW, 0, fourBit, interpolation)


  setWaypoint : =>

    unless @record
      return

    position  = @cam.getPosition()
    rotation = @cam.getRotation()

    @addNode(position, rotation)


  changeMoveValue : (delta) ->

    moveValue = @model.user.get("moveValue3d") + delta
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue)
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue)

    @model.user.set("moveValue3d", (Number) moveValue)


  setParticleSize : (delta) ->

    particleSize = @model.user.get("particleSize") + delta
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize)
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize)

    @model.user.set("particleSize", (Number) particleSize)


  setClippingDistance : (value) ->

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

      # animate the change to the new position and new rotation
      curPos = @cam.getPosition()
      newPos = @model.skeletonTracing.getActiveNodePos()
      curRotation = @cam.getRotation()
      newRotation = @model.skeletonTracing.getActiveNodeRotation()
      newRotation = @getShortestRotation(curRotation, newRotation)

      waypointAnimation = new TWEEN.Tween(
        {x: curPos[0], y: curPos[1], z: curPos[2], rx: curRotation[0], ry: curRotation[1], rz: curRotation[2], cam: @cam})
      waypointAnimation.to(
        {x: newPos[0], y: newPos[1], z: newPos[2], rx: newRotation[0], ry: newRotation[1], rz: newRotation[2]}, 200)
      waypointAnimation.onUpdate( ->
        @cam.setPosition([@x, @y, @z])
        @cam.setRotation([@rx, @ry, @rz])
      )
      waypointAnimation.start()

      @cam.update()


  setActiveNode : (nodeId, centered, mergeTree) ->

    @model.skeletonTracing.setActiveNode(nodeId, mergeTree)
    @cam.setPosition(@model.skeletonTracing.getActiveNodePos())
    @cam.setRotation(@model.skeletonTracing.getActiveNodeRotation())


  getShortestRotation : (curRotation, newRotation) ->

    for i in [0..2]
      # a rotation about more than 180° is shorter when rotating the other direction
      if newRotation[i] - curRotation[i] > 180
        newRotation[i] -= 360
      else if newRotation[i] - curRotation[i] < -180
        newRotation[i] += 360
    return newRotation


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
    vectorLength = V3.length(vector)

    if vectorLength > 10
      @setWaypoint()
      @lastNodeMatrix = matrix


module.exports = ArbitraryController
