### define
jquery : $
underscore : _
libs/event_mixin : EventMixin
libs/request : Request
libs/input : Input
../geometries/arbitrary_plane : ArbitraryPlane
../geometries/crosshair : Crosshair
../view/arbitrary_view : ArbitraryView
../geometries/arbitrary_plane_info : ArbitraryPlaneInfo
../constants : constants
###

class ArbitraryController

  WIDTH : 128
  HEIGHT : 128

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


  constructor : (@model, stats, @gui, renderer, scene, @sceneController) ->

    _.extend(this, new EventMixin())

    @isStarted = false

    @canvas = canvas = $("#render-canvas")
    
    @cam = @model.flycam3d
    @view = new ArbitraryView(canvas, @cam, stats, renderer, scene, @model.scaleInfo)

    @plane = new ArbitraryPlane(@cam, @model, @WIDTH, @HEIGHT)
    @view.addGeometry @plane

    @infoPlane = new ArbitraryPlaneInfo()

    @input = _.extend({}, @input)

    @crosshair = new Crosshair(@cam, model.user.crosshairSize)
    @view.addGeometry(@crosshair)

    @bind()
    @view.draw()

    @stop()


  render : (forceUpdate, event) ->

    matrix = @cam.getMatrix()
    @model.binary.arbitraryPing(matrix)


  initMouse : ->
    @input.mouse = new Input.Mouse(
      @canvas
      leftDownMove : (delta) =>
        @cam.yawDistance(
          -delta.x * @model.user.getMouseInversionX() * @model.user.mouseRotateValue
        );
        @cam.pitchDistance(
          delta.y * @model.user.getMouseInversionY() * @model.user.mouseRotateValue
        )
      scroll : @scroll
    )


  initKeyboard : ->

    getVoxelOffset  = (timeFactor) =>
      return @model.user.moveValue3d * timeFactor / @model.scaleInfo.baseVoxel / constants.FPS
    
    @input.keyboard = new Input.Keyboard(
 
      #Scale plane
      "l"             : (timeFactor) => @view.applyScale -@model.user.scaleValue
      "k"             : (timeFactor) => @view.applyScale  @model.user.scaleValue

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
      "left"          : (timeFactor) => @cam.yawDistance @model.user.rotateValue * timeFactor
      "right"         : (timeFactor) => @cam.yawDistance -@model.user.rotateValue * timeFactor
      "up"            : (timeFactor) => @cam.pitchDistance -@model.user.rotateValue * timeFactor
      "down"          : (timeFactor) => @cam.pitchDistance @model.user.rotateValue * timeFactor
      
      #Rotate at centre
      "shift + left"  : (timeFactor) => @cam.yaw @model.user.rotateValue * timeFactor
      "shift + right" : (timeFactor) => @cam.yaw -@model.user.rotateValue * timeFactor
      "shift + up"    : (timeFactor) => @cam.pitch @model.user.rotateValue * timeFactor
      "shift + down"  : (timeFactor) => @cam.pitch -@model.user.rotateValue * timeFactor

      #Zoom in/out
      "i"             : (timeFactor) => @cam.zoomIn()
      "o"             : (timeFactor) => @cam.zoomOut()

      #Change move value
      "h"             : (timeFactor) => @changeMoveValue(25)
      "g"             : (timeFactor) => @changeMoveValue(-25)
    )
    
    @input.keyboardNoLoop = new Input.KeyboardNoLoop(

      "1" : => @sceneController.toggleSkeletonVisibility()
      "2" : => @sceneController.toggleInactiveTreeVisibility()

      #Delete active node
      "delete" : => @model.route.deleteActiveNode()
      "c" : => @model.route.createNewTree()
      
      #Branches
      "b" : => @pushBranch()
      "j" : => @popBranch() 
      
      #Reset Matrix
      "r" : => @cam.resetRotation()

      #Recenter active node
      "y" : => @centerActiveNode()

      #Recording of Waypoints
      "z" : => 
        @record = true
        @infoPlane.updateInfo(true)
        @setWaypoint()
      "u" : => 
        @record = false
        @infoPlane.updateInfo(false)
      #Comments
      "n" : => @setActiveNode(@model.route.nextCommentNodeID(false), true)
      "p" : => @setActiveNode(@model.route.nextCommentNodeID(true), true)
    )

    @input.keyboardOnce = new Input.Keyboard(

      #Delete active node and recenter last node
      "shift + space" : =>
        @model.route.deleteActiveNode()
        @centerActiveNode()
        
    , -1)

  init : ->

    @setRouteClippingDistance @model.user.routeClippingDistance
    @view.applyScale(0)


  bind : ->

    @view.on "render", (force, event) => @render(force, event)
    @view.on "finishedRender", => @model.route.rendered()

    @model.binary.cube.on "bucketLoaded", => @view.draw()

    @model.user.on "crosshairSizeChanged", (value) =>
      @crosshair.setScale(value)

    @model.user.on "routeClippingDistanceArbitraryChanged", (value) =>
      @setRouteClippingDistance(value)


  start : ->

    @stop()

    @initKeyboard()
    @initMouse()
    @view.start()
    @init()
    @view.draw()    

    @isStarted = true 
 

  stop : ->

    if @isStarted
      @input.unbind()
    
    @view.stop()

    @isStarted = false


  scroll : (delta, type) =>

    switch type
      when "shift" then @setParticleSize(delta)


  addNode : (position) =>

    @model.route.addNode(position, constants.TYPE_USUAL)


  setWaypoint : () =>

    unless @record 
      return

    position  = @cam.getPosition()
    activeNodePos = @model.route.getActiveNodePos()

    @addNode(position)

  changeMoveValue : (delta) ->

    moveValue = @model.user.moveValue3d + delta
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue)
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue)

    @model.user.setValue("moveValue3d", (Number) moveValue)


  setParticleSize : (delta) =>

    particleSize = @model.user.particleSize + delta
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize)
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize)

    @model.user.setValue("particleSize", (Number) particleSize)


  setRouteClippingDistance : (value) =>

    @view.setRouteClippingDistance(value)


  pushBranch : ->

    @model.route.pushBranch()


  popBranch : ->

    _.defer => @model.route.popBranch().done((id) => 
      @setActiveNode(id, true)
    )


  centerActiveNode : ->

    activeNode = @model.route.getActiveNode()
    if activeNode
      @cam.setPosition(activeNode.pos)
      parent = activeNode.parent
      while parent
        # set right direction
        direction = ([
          activeNode.pos[0] - parent.pos[0],
          activeNode.pos[1] - parent.pos[1],
          activeNode.pos[2] - parent.pos[2]])
        if direction[0] or direction[1] or direction[2]
          @cam.setDirection( @model.scaleInfo.voxelToNm( direction ))
          break
        parent = parent.parent


  setActiveNode : (nodeId, centered, mergeTree) ->

    @model.route.setActiveNode(nodeId, mergeTree)
    @cam.setPosition @model.route.getActiveNodePos()  


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