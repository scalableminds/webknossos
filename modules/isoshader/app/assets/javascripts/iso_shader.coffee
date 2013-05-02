### define
libs/input : Input
./isoshader/view : View
./isoshader/data_cam : DataCam
###

class Isoshader

  NUM_SURFACES : 1
  MOUSE_SMOOTHING : 0.2

  constructor : ->

    @canvas = $("#webgl_canvas")
    @dataCam = new DataCam()
    @view = new View(@canvas, @dataCam)

    # let's get started
    @initSurfaces()
    @initKeyboard()
    @initMouse()
    @initGUI()
    @view.initThreeJS(@surfaces)


  #das hier ider bösewicht, der's langsam macht
  initSurfaces : ->

    @surfaces = for i in [0 ... @NUM_SURFACES]

      surface =
        threshold : 0.61
        uniform_name : "surface_#{i}"
        draw_surface : 1
        draw_map : 1


  initKeyboard : ->

    input = new Input.KeyboardNoLoop(
      #enable or disable surface
      "m" : => @surfaces[0].draw_surface = +!@surfaces[0].draw_surface
      "p" : => @surfaces[1].draw_surface = +!@surfaces[1].draw_surface

      "t" : => @view.debug_mode = +!@view.debug_mode
      "F11" : =>
        if requestFullscreen
          requestFullscreen.call(canvas, canvas.ALLOW_KEYBOARD_INPUT)

      # thresholds
      "," : => @surfaces[0].threshold
      "." : => @surfaces[0].threshold
      "[" : => @surfaces[1].threshold
      "]" : => @surfaces[1].threshold
    )

    new Input.Keyboard(

      "w" : => @dataCam.move("z")
      "s" : => @dataCam.move("z", -1)
      "d" : => @dataCam.move("x")
      "a" : => @dataCam.move("x", -1)
      "r" : => @dataCam.move("y")
      "f" : => @dataCam.move("y", -1)

      "up" :    => @dataCam.rotate("x")
      "down" :  => @dataCam.rotate("x", -1)
      "right" : => @dataCam.rotate("y")
      "left" :  => @dataCam.rotate("y", -1)
      "q" :     => @dataCam.rotate("z")
      "e" :     => @dataCam.rotate("z", -1)


    )


  initMouse : ->

    new Input.Mouse(
      @canvas,
      leftDownMove : ( delta ) =>
        @dataCam.rotate("y", delta.x * @MOUSE_SMOOTHING)
        @dataCam.rotate("x", delta.y * @MOUSE_SMOOTHING)
    )


  initGUI : ->

    qualitySelection = $("#quality")
    qualitySelection.on( "change", (evt) =>
      @view.setUniform("quality", evt.target.selectedIndex)
      @view.resize()
    )

    shadingSelection = $("#shading")
    shadingSelection.on( "change", (evt) =>
      @view.setUniform("shading_type", evt.target.selectedIndex)
    )

    canvas = @canvas[0]
    requestFullscreen = canvas.webkitRequestFullScreen or canvas.mozRequestFullScreen or canvas.RequestFullScreen
    fullscreenButton = $("#fullscreenButton").on("click", (evt) =>
      if requestFullscreen
        requestFullscreen.call(canvas, canvas.ALLOW_KEYBOARD_INPUT)
    )









