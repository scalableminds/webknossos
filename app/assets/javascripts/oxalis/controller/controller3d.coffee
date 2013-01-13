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

  WIDTH : 128
  HEIGHT : 128

  plane : null
  cam : null


  model : null
  view : null

  input :
    mouse : null
    keyboard : null

    unbind : ->
      @mouse?.unbind()
      @keyboard?.unbind()


  constructor : (@model) ->

    _.extend(this, new EventMixin())

    @canvas = canvas = $("#arbitraryplane")
   
    
    @cam = @model.flycam3d
    @view = new ArbitraryView(canvas, @cam)    

    @plane = new ArbitraryPlane(@cam, @model.binary, @WIDTH, @HEIGHT)  
    @view.addGeometry @plane

    @cam.setPos([1924, 1543, 1823])

    @input = _.extend({}, @input)
    

    Mesh.load("crosshair.js").done (crossHair) =>   
      crossHair.setPosition(0, 0, -1)
      @view.addGeometry(crossHair)

    @view.on "render", (force, event) => @doRender(force, event)

    #@model.binary.on "bucketLoaded", => @view.draw()

    @cam.on "changed", =>
      @trigger("matrixChanged", @cam.getMatrix())

    @view.draw()


  doRender : (forceUpdate, event) ->

    # skip rendering if nothing has changed
    # This prevents you the GPU/CPU from constantly
    # working and keeps your lap cool
    # ATTENTION: this limits the FPS to 30 FPS (depending on the keypress update frequence)
    return event.stop() unless @cam.flush() or forceUpdate

    # sends current position to Model for calculating current 
    # speed and preloading data
    #@model.binary.notifyMatrix @cam.getMatrix()


  initMouse : ->
    @input.mouse = new Input.Mouse(
      @canvas
      "x" : (distX) =>
        @cam.yawDistance(
          distX * @model.user.configuration.mouseInversionX * @model.user.configuration.mouseRotateValue
        )
      "y" : (distY) =>
        @cam.pitchDistance(
          distY * @model.user.configuration.mouseInversionY * @model.user.configuration.mouseRotateValue
        )
    )

  initKeyboard : ->
    
    @input.keyboard = new Input.Keyboard(

      #Fullscreen Mode
      "f" : => 
        canvas = @canvas
        requestFullscreen = canvas.webkitRequestFullScreen or canvas.mozRequestFullScreen or canvas.RequestFullScreen
        if requestFullscreen
          requestFullscreen.call(canvas, canvas.ALLOW_KEYBOARD_INPUT)

      #Scaleplane
      "l" : => @plane?.applyScale -@model.user.scaleValue
      "k" : => @plane?.applyScale  @model.user.scaleValue

      #Move   
      "w" : => @cam.move [0, -@model.user.moveValue, 0]
      "s" : => @cam.move [0, @model.user.moveValue, 0]
      "a" : => @cam.move [-@model.user.moveValue, 0, 0]
      "d" : => @cam.move [@model.user.moveValue, 0, 0]
      "space" : =>  @cam.move [0, 0, @model.user.moveValue]
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
    )
    
    new Input.KeyboardNoLoop(

      #Branches
      #"b" : => Model.Route.putBranch(@cam.getMatrix())
      #"h" : => Model.Route.popBranch().done((matrix) => @cam.setMatrix(matrix))

      #Zoom in/out
      #"o" : => @cam.zoomIn()
      #"p" : => @cam.zoomOut()


    )

  bind : ->

    @initKeyboard()
    @initMouse()

  unbind : ->

    @input.unbind()

  show : ->

  hide : ->


    #@model.stop()
    #@view.stop()    