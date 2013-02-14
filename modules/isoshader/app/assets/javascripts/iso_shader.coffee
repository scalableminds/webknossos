### define
libs/input : Input
./isoshader/view : View
./isoshader/data_cam : DataCam
###

class Isoshader

  NUM_SURFACES : 1

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

    $(window).on "mousemove",(event) =>
      # @parameters.mouseX = event.clientX / window.innerWidth
      # @parameters.mouseY = 1 - event.clientY / window.innerHeight

    new Input.Mouse(
      @canvas
      "x" : (distX) =>
        @dataCam.rotate("x", distX)
      "y" : (distY) =>

    )

      # var x=event.clientX;
      # var y=event.clientY;
      # var dx=x-cam.mouse_prev_x;
      # var dy=y-cam.mouse_prev_y;
      # cam.mouse_prev_x=x;
      # cam.mouse_prev_y=y;
      # if(cam.mouse_is_down){
      #   quat4.multiply(cam.dir, quat4.createFrom(dy*turn_speed, dx*turn_speed,0,1.0));
      #   quat4.normalize(cam.dir);
      # }


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









