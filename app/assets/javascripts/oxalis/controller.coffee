### define
jquery : $
underscore : _
./controller/plane_controller : PlaneController
./controller/arbitrary_controller : ArbitraryController
./controller/abstract_tree_controller : AbstractTreeController
./model : Model
../libs/event_mixin : EventMixin
../libs/input : Input
###

TYPE_USUAL       = 0
TYPE_BRANCH      = 1
VIEWPORT_WIDTH   = 380
WIDTH            = 384
TEXTURE_SIZE     = 512
TEXTURE_SIZE_P   = 9
DISTANCE_3D      = 140

MODE_2D          = 0
MODE_3D          = 1


class Controller

  mode : null
  view : null
  planeController : null
  arbitraryController : null
  abstractTreeController : null
  

  constructor : ->

    _.extend(@, new EventMixin())

    @fullScreen = false
    @mode = MODE_2D

    @model = new Model()

    @model.initialize(TEXTURE_SIZE_P, VIEWPORT_WIDTH, DISTANCE_3D).done =>

      # FPS stats
      stats = new Stats()
      stats.getDomElement().id = "stats"
      $("body").append stats.getDomElement() 



      @planeController = new PlaneController(@model, stats)
      @planeController.bind()
      @planeController.start()
      @arbitraryController = new ArbitraryController(@model, stats)

      abstractTreeController = new AbstractTreeController(@model)      


      @initMouse()
      @initKeyboard()


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

      #View
      "q" : => @toggleFullScreen()


      #ScaleTrianglesPlane
      "m" : => @switch()
    )


  switch : ->
    
    if @mode is MODE_2D
      @planeController.unbind()
      @planeController.stop() 
      @initKeyboard()     

      @arbitraryController.bind()
      @arbitraryController.cam.setPosition(@planeController.flycam.getPosition())
      @arbitraryController.show()
      @mode = MODE_3D
    else
      @arbitraryController.unbind()
      @arbitraryController.hide()      
      @initKeyboard()


      @planeController.bind()
      @planeController.flycam.setPosition(@arbitraryController.cam.getPosition())
      @planeController.start()
      @mode = MODE_2D


  toggleFullScreen : ->

    if @fullScreen
      cancelFullscreen = document.webkitCancelFullScreen or document.mozCancelFullScreen or document.cancelFullScreen
      @fullScreen = false
      if cancelFullscreen
        cancelFullscreen.call(document)
    else
      body = $("body")[0]
      requestFullscreen = body.webkitRequestFullScreen or body.mozRequestFullScreen or body.requestFullScreen
      @fullScreen = true
      if requestFullscreen
        requestFullscreen.call(body, body.ALLOW_KEYBOARD_INPUT)

