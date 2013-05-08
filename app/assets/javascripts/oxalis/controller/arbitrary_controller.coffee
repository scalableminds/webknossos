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

    @model.route.rendered()


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
    
    @input.keyboard = new Input.Keyboard(
 
      #Scale plane
      "l" : => @view.applyScale -@model.user.scaleValue
      "k" : => @view.applyScale  @model.user.scaleValue

      #Move   
      "w" : => @cam.move [0, @model.user.moveValue3d, 0]
      "s" : => @cam.move [0, -@model.user.moveValue3d, 0]
      "a" : => @cam.move [@model.user.moveValue3d, 0, 0]
      "d" : => @cam.move [-@model.user.moveValue3d, 0, 0]
      "space" : =>  
        @cam.move [0, 0, @model.user.moveValue3d]
        @moved()
      "alt + space" : => @cam.move [0, 0, -@model.user.moveValue3d]
      
      #Rotate in distance
      "left"  : => @cam.yawDistance @model.user.rotateValue
      "right" : => @cam.yawDistance -@model.user.rotateValue
      "up"    : => @cam.pitchDistance -@model.user.rotateValue
      "down"  : => @cam.pitchDistance @model.user.rotateValue
      
      #Rotate at centre
      "shift + left"  : => @cam.yaw @model.user.rotateValue
      "shift + right" : => @cam.yaw -@model.user.rotateValue
      "shift + up"    : => @cam.pitch @model.user.rotateValue
      "shift + down"  : => @cam.pitch -@model.user.rotateValue

      #Zoom in/out
      "i" : => @cam.zoomIn()
      "o" : => @cam.zoomOut()

      #Change move value
      "h" : => @changeMoveValue(0.1)
      "g" : => @changeMoveValue(-0.1)
    )
    
    @input.keyboardNoLoop = new Input.KeyboardNoLoop(

      "8" : => @sceneController.toggleSkeletonVisibility()
      "9" : => @sceneController.toggleInactiveTreeVisibility()

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

    if @model.user.newNodeNewTree == true
      @createNewTree()
      @model.route.one("rendered", =>
        @model.route.one("rendered", =>
          @model.route.addNode(position, constants.TYPE_USUAL)))
    else
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

    @gui.updateMoveValue3d(moveValue)


  setParticleSize : (delta) =>

    @model.route.setParticleSize(@model.route.getParticleSize() + delta)


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