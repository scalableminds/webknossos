### define
jquery : $
underscore : _
./controller/controller2d : Controller2d
./controller/controller3d : Controller3d
./model : Model
../libs/event_mixin : EventMixin
../libs/input : Input
../libs/toast : Toast
###

TYPE_USUAL        = 0
TYPE_BRANCH       = 1
VIEWPORT_WIDTH    = 380
WIDTH             = 384
TEXTURE_SIZE      = 512
TEXTURE_SIZE_P    = 9
DISTANCE_3D       = 140
ALLOWED_OXALIS    = MODE_OXALIS    = 0
ALLOWED_ARBITRARY = MODE_ARBITRARY = 1


class Controller

  allowedModes : []
  mode : MODE_OXALIS


  constructor : ->

    _.extend(@, new EventMixin())
    @fullScreen = false

    @model = new Model()

    @model.initialize(TEXTURE_SIZE_P, VIEWPORT_WIDTH, DISTANCE_3D).done (settings) =>

      for allowedMode in settings.allowedModes
        @allowedModes.push switch allowedMode
          when "oxalis" then ALLOWED_OXALIS
          when "arbitrary" then ALLOWED_ARBITRARY

      # FPS stats
      stats = new Stats()
      stats.getDomElement().id = "stats"
      $("body").append stats.getDomElement() 

      @controller2d = new Controller2d(@model, stats)
      @controller2d.bind()
      @controller2d.start()
      @controller3d = new Controller3d(@model, stats)


      @initMouse()
      @initKeyboard()


      if ALLOWED_OXALIS not in @allowedModes
        if ALLOWED_ARBITRARY in @allowedModes
          @switch()
        else
          Toast.error("There was no valid allowed tracing mode specified.")


  initMouse : ->

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault()
      return


  initKeyboard : ->
    
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or event.which == 18 or 37 <= event.which <= 40) and !$(":focus").length
      return

    new Input.KeyboardNoLoop(

      #ScaleTrianglesPlane
      "m" : => @switch()
      "esc" : => @leave3d()
    )


  switch : ->
    
    if @mode is MODE_OXALIS and ALLOWED_ARBITRARY in @allowedModes
      @controller2d.unbind()
      @controller2d.stop() 
      @initKeyboard()     

      @controller3d.bind()
      @controller3d.cam.setPos(@controller2d.flycam.getGlobalPos())
      @controller3d.show()
      @mode = MODE_ARBITRARY
    else if @mode is MODE_ARBITRARY and ALLOWED_OXALIS in @allowedModes
      @controller3d.unbind()
      @controller3d.hide()      
      @initKeyboard()


      @controller2d.bind()
      @controller2d.flycam.setGlobalPos(@controller3d.cam.getPosition())
      @controller2d.start()
      @mode = MODE_OXALIS


  leave3d : ->

    if @mode isnt MODE_OXALIS
      @switch()
