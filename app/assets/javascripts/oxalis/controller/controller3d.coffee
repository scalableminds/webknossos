### define
jquery : $
underscore : _
libs/event_mixin : EventMixin
libs/request : Request
../../libs/input : Input
../geometries/arbitrary_plane : ArbitraryPlane
../geometries/mesh : Mesh
../view/arbitrary_view : ArbitraryView
###

class Controller3d

  WIDTH : 256
  HEIGHT : 128

  plane : null
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

    @plane = new ArbitraryPlane(@cam, @model.binary, @WIDTH, @HEIGHT)
    @view.addGeometry @plane

    @input = _.extend({}, @input)

    Mesh.load("crosshair.js").done (crossHair) =>   
      crossHair.setPosition(0, 0, -1)
      @view.addGeometry(crossHair)

    @view.draw()


  render : (forceUpdate, event) ->

    matrix = @cam.getMatrix()
    @model.binary.arbitraryPing(matrix)

    @model.route.rendered()


  toggleFullScreen : ->

    if @fullScreen
      cancelFullscreen = document.webkitCancelFullScreen or document.mozCancelFullScreen or document.cancelFullScreen
      @fullScreen = false
      if cancelFullscreen
        cancelFullscreen.call(document)
    else
      body = $("#arbitraryplane")[0]
      requestFullscreen = body.webkitRequestFullScreen or body.mozRequestFullScreen or body.requestFullScreen
      @fullScreen = true
      if requestFullscreen
        requestFullscreen.call(body, body.ALLOW_KEYBOARD_INPUT)


  initMouse : ->
    @input.mouse = new Input.Mouse(
      @canvas
      leftDownMove : (delta) =>
        @cam.yawDistance(
          -delta.x * @model.user.mouseInversionX * @model.user.mouseRotateValue
        );
        @cam.pitchDistance(
          delta.y * @model.user.mouseInversionY * @model.user.mouseRotateValue
        )
    )


  initKeyboard : ->
    
    @input.keyboard = new Input.Keyboard(

      #Scaleplane
      "l" : => @plane?.applyScale -@model.user.scaleValue
      "k" : => @plane?.applyScale  @model.user.scaleValue

      #Move   
      "w" : => @cam.move [0, -@model.user.moveValue, 0]
      "s" : => @cam.move [0, @model.user.moveValue, 0]
      "a" : => @cam.move [-@model.user.moveValue, 0, 0]
      "d" : => @cam.move [@model.user.moveValue, 0, 0]
      "space" : =>  
        @cam.move [0, 0, @model.user.moveValue]
        @moved()
      "shift + space" : => @cam.move [0, 0, -@model.user.moveValue]
      
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

      #Fullscreen Mode
      "q" : => @toggleFullScreen()

      #Reset Matrix
      "r" : => @cam.resetRotation()

      #Branches
      "b" : => @pushBranch()
      "j" : => @popBranch() 

      #Recording of Waypoints
      "t" : => @record = true
      "z" : => @record = false      
    )


  bind : ->

    @initKeyboard()
    @initMouse()

    @view.on "render", (force, event) => @render(force, event)

    @model.binary.cube.on "bucketLoaded", => @view.draw()

    @cam.on "changed", =>
      @trigger("matrixChanged", @cam.getMatrix())    


  unbind : ->

    @input.unbind()
    @view.off "render", (force, event) => @render(force, event)

    @model.binary.cube.on "bucketLoaded", => @view.draw()

    @cam.off "changed", =>
      @trigger("matrixChanged", @cam.getMatrix())       


  show : ->

    @canvas.show()
    @view.start()
    @view.draw()    


  hide : ->

    @canvas.hide()
    @view.stop()


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
    @cam.setPos @model.route.getActiveNodePos()  


  moved : =>

    matrix = @cam.getMatrix()

    unless @lastNodeMatrix?
      @lastNodeMatrix = matrix
      @setWaypoint()

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