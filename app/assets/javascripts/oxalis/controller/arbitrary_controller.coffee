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
###

TYPE_USUAL = 0

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

    unbind : ->
      @mouse?.unbind()
      @keyboard?.unbind()
      @keyboardNoLoop?.unbind()


  constructor : (@model, stats) ->

    _.extend(this, new EventMixin())

    @canvas = canvas = $("#arbitraryplane")
    canvas.hide()
   
    
    @cam = @model.flycam3d
    @view = new ArbitraryView(canvas, @cam, stats)    

    @plane = new ArbitraryPlane(@cam, @model, @WIDTH, @HEIGHT)
    @view.addGeometry @plane

    @infoPlane = new ArbitraryPlaneInfo()
    @view.addGeometry @infoPlane

    @input = _.extend({}, @input)

    @crosshair = new Crosshair(model.user.crosshairSize)
    @view.addGeometry(@crosshair)

    @bind()
    @view.draw()


  render : (forceUpdate, event) ->

    matrix = @cam.getMatrix()
    @model.binary.arbitraryPing(matrix)

    @model.route.rendered()


  initMouse : ->
    @input.mouse = new Input.Mouse(
      @canvas
      leftDownMove : (delta) =>
        mouseInversionX = if @model.user.inverseX then 1 else -1
        mouseInversionY = if @model.user.inverseY then 1 else -1
        @cam.yawDistance(
          -delta.x * mouseInversionX * @model.user.mouseRotateValue
        );
        @cam.pitchDistance(
          delta.y * mouseInversionY * @model.user.mouseRotateValue
        )
    )


  initKeyboard : ->
    
    @input.keyboard = new Input.Keyboard(

      #Scale plane
      "l" : => @plane.applyScale -@model.user.scaleValue
      "k" : => @plane.applyScale  @model.user.scaleValue

      #Move   
      "w" : => @cam.move [0, -@model.user.moveValue3d, 0]
      "s" : => @cam.move [0, @model.user.moveValue3d, 0]
      "a" : => @cam.move [-@model.user.moveValue3d, 0, 0]
      "d" : => @cam.move [@model.user.moveValue3d, 0, 0]
      "space" : =>  
        @cam.move [0, 0, @model.user.moveValue3d]
        @moved()
      "shift + space" : => @cam.move [0, 0, -@model.user.moveValue3d]
      
      #Rotate in distance
      "left"  : => @cam.yawDistance -@model.user.rotateValue
      "right" : => @cam.yawDistance @model.user.rotateValue
      "up"    : => @cam.pitchDistance @model.user.rotateValue
      "down"  : => @cam.pitchDistance -@model.user.rotateValue
      
      #Rotate at centre
      "shift + left"  : => @cam.yaw @model.user.rotateValue
      "shift + right" : => @cam.yaw -@model.user.rotateValue
      "shift + up"    : => @cam.pitch -@model.user.rotateValue
      "shift + down"  : => @cam.pitch @model.user.rotateValue

      #Zoom in/out
      "i" : => @cam.zoomIn()
      "o" : => @cam.zoomOut()      
    )
    
    @input.keyboardNoLoop = new Input.KeyboardNoLoop(
      
      #Branches
      "b" : => @pushBranch()
      "j" : => @popBranch() 
      
      #Reset Matrix
      "r" : => @cam.resetRotation()

      #Recording of Waypoints
      "z" : => 
        @record = true
        @infoPlane.updateInfo(true)
        @setWaypoint()
      "u" : => 
        @record = false
        @infoPlane.updateInfo(false)
    )


  bind : ->

    @view.on "render", (force, event) => @render(force, event)

    @model.binary.cube.on "bucketLoaded", => @view.draw()

    @model.user.on "crosshairSizeChanged", (value) =>
      @crosshair.setScale(value)


  start : ->

    @initKeyboard()
    @initMouse()
    @canvas.show()
    @view.start()
    @view.draw()     
 

  stop : ->

    @view.stop()
    @input.unbind()
    @canvas.hide()


  addNode : (position) =>

    if @model.user.newNodeNewTree == true
      @createNewTree()
      @model.route.one("rendered", =>
        @model.route.one("rendered", =>
          @model.route.addNode(position, TYPE_USUAL)))
    else
      @model.route.addNode(position, TYPE_USUAL)


  setWaypoint : () =>

    unless @record 
      return

    position  = @cam.getPosition()
    activeNodePos = @model.route.getActiveNodePos()

    @addNode(position)    


  pushBranch : ->

    @model.route.pushBranch()


  popBranch : ->

    _.defer => @model.route.popBranch().done((id) => 
      @setActiveNode(id, true)
    )


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