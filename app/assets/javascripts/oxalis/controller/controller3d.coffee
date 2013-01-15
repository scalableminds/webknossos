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


  model : null
  view : null

  input :
    mouse : null
    keyboard : null

    unbind : ->
      @mouse?.unbind()
      @keyboard?.unbind()


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

    @model.binary.arbitraryPing(@cam.getMatrix())
    #                    @flycam.getArea(PLANE_YZ), @flycam.getArea(PLANE_XZ)], activePlane: @flycam.getActivePlane()})
    #@model.route.globalPosition = @cam.getGlobalPos()
    @model.route.rendered()

    # skip rendering if nothing has changed
    # This prevents you the GPU/CPU from constantly
    # working and keeps your lap cool
    # ATTENTION: this limits the FPS to 30 FPS (depending on the keypress update frequence)
    #return event.stop() unless @cam.flush() or forceUpdate

    # sends current position to Model for calculating current 
    # speed and preloading data
    #@model.binary.notifyMatrix @cam.getMatrix()


  initMouse : ->
    @input.mouse = new Input.Mouse(
      @canvas
      leftDownMove : (delta) =>
        @cam.yawDistance(
          delta.x * @model.user.mouseInversionX * @model.user.mouseRotateValue
        );
        @cam.pitchDistance(
          delta.y * @model.user.mouseInversionY * @model.user.mouseRotateValue
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



    #@model.stop()
    #@view.stop()    