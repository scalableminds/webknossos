### define
jquery : $
underscore : _
./controller/viewmodes/plane_controller : PlaneController
./controller/annotations/celltracing_controller : CellTracingController
./controller/annotations/volumetracing_controller : VolumeTracingController
./controller/combinations/celltracing_arbitrary_controller : CellTracingArbitraryController
./controller/combinations/celltracing_plane_controller : CellTracingPlaneController
./controller/combinations/volumetracing_plane_controller : VolumeTracingPlaneController
./controller/scene_controller : SceneController
./model : Model
./view : View
./view/skeletontracing_view : SkeletonTracingView
./view/volumetracing_view : VolumeTracingView
../libs/event_mixin : EventMixin
../libs/input : Input
./view/gui : Gui
../libs/toast : Toast
./constants : constants
###

class Controller

  # Main controller, responsible for setting modes and everything
  # that has to be controlled in any mode.
  #
  # We have a matrix of modes like this:
  #
  #   Annotation Mode \ View mode    Plane       Arbitrary
  #              Skeleton Tracing      X             X
  #                Volume Tracing      X             /
  # 
  # In order to maximize code reuse, there is - besides the main
  # controller - a controller for each row, each column and each
  # cross in this matrix.

  view : null
  planeController : null
  arbitraryController : null
  abstractTreeController : null
  allowedModes : []
  

  constructor : (@controlMode) ->

    _.extend(@, new EventMixin())

    @fullScreen = false
    @mode = constants.MODE_PLANE_TRACING

    @model = new Model()

    @model.initialize( @controlMode ).done ({restrictions, settings, error}) =>

      # Do not continue, when there was an error and we got no settings from the server
      if error
        return

      unless restrictions.allowAccess
        Toast.Error "You are not allowed to access this tracing"
        return

      for allowedMode in settings.allowedModes
        @allowedModes.push switch allowedMode
          when "oxalis" then constants.MODE_PLANE_TRACING
          when "arbitrary" then constants.MODE_ARBITRARY
          when "volume" then constants.MODE_VOLUME

      if constants.MODE_ARBITRARY in @allowedModes
        @allowedModes.push(constants.MODE_ARBITRARY_PLANE)

      # FPS stats
      stats = new Stats()
      stats.getDomElement().id = "stats"
      $("body").append stats.getDomElement()

      @gui = @createGui(restrictions, settings)

      @sceneController = new SceneController(
        @model.binary["color"].cube.upperBoundary, @model.flycam, @model)


      if @model.cellTracing?

        @view = new SkeletonTracingView(@model)
        @annotationController = new CellTracingController(
          @model, @sceneController, @gui, @view )
        @planeController = new CellTracingPlaneController(
          @model, stats, @gui, @view, @sceneController, @annotationController)
        @arbitraryController = new CellTracingArbitraryController(
          @model, stats, @gui, @view, @sceneController)
      
      else if @model.volumeTracing?
        
        @view = new VolumeTracingView(@model)
        @annotationController = new CellTracingController(
          @model, @sceneController, @gui, @view )
        @planeController = new VolumeTracingPlaneController(
          @model, stats, @gui, @view, @sceneController, @annotationController)

      else # View mode

        @view = new View(@model)
        @planeController = new PlaneController(
          @model, stats, @gui, @view, @sceneController)

      @initMouse()
      @initKeyboard()

      for binaryName of @model.binary
        @model.binary[binaryName].cube.on "bucketLoaded" : =>
          @model.flycam.update()

      if @controlMode == constants.CONTROL_MODE_VIEW
        $('#alpha-slider').slider().on "slide", (event) =>

          alpha = event.value
          if (alpha == 0)
            @model.binary["segmentation"].pingStop()
          @sceneController.setSegmentationAlpha( alpha )

      @modeMapping =
        "view-mode-3planes"        : constants.MODE_PLANE_TRACING
        "view-mode-sphere"         : constants.MODE_ARBITRARY
        "view-mode-arbitraryplane" : constants.MODE_ARBITRARY_PLANE

      _controller = this
      for button in $("#view-mode .btn-group").children()
        
        id = @modeMapping[ $(button).attr("id") ]
        do (id) ->
          $(button).on "click", ->
            _controller.setMode( id )

        if not (id in @allowedModes)
          $(button).attr("disabled", "disabled")

      if @allowedModes.length == 1
        $("#view-mode").hide()

      @allowedModes.sort()
      #@setMode( constants.MODE_PLANE_TRACING, true )
      if @allowedModes.length == 0
        Toast.error("There was no valid allowed tracing mode specified.")
      else
        @setMode( @allowedModes[0] )

      # initial trigger
      @sceneController.setSegmentationAlpha($('#alpha-slider').data("slider-value") or constants.DEFAULT_SEG_ALPHA)


  initMouse : ->

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault()
      return


  initKeyboard : ->

    $(document).keypress (event) ->
      
      if event.shiftKey && event.which == 63
        $("#help-modal").modal('toggle')


    
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or event.which == 18 or 37 <= event.which <= 40) and !$(":focus").length
      return

    keyboardControls = {
      "q" : => @toggleFullScreen()
    }

    if @controlMode == constants.CONTROL_MODE_TRACE
      _.extend( keyboardControls, {
        #Set Mode, outcomment for release
        "shift + 1" : =>
          @setMode(constants.MODE_PLANE_TRACING)
        "shift + 2" : =>
          @setMode(constants.MODE_ARBITRARY)
        "shift + 3" : =>
          @setMode(constants.MODE_ARBITRARY_PLANE)
        "shift + 4" : =>
          @setMode(constants.MODE_VOLUME)
          
        "t" : => 
          @view.toggleTheme()       
          @abstractTreeController.drawTree()

        "m" : => # rotate allowed modes

          index = (@allowedModes.indexOf(@mode) + 1) % @allowedModes.length
          @setMode( @allowedModes[index] )

        "super + s, ctrl + s" : (event) =>

          event.preventDefault()
          event.stopPropagation()
          @gui.saveNow()
      } )

    new Input.KeyboardNoLoop( keyboardControls )

  setMode : (newMode, force = false) ->

    if (newMode == constants.MODE_ARBITRARY or newMode == constants.MODE_ARBITRARY_PLANE) and (newMode in @allowedModes or force)
      @planeController?.stop()
      @arbitraryController.start(newMode)

    else if (newMode == constants.MODE_PLANE_TRACING or newMode == constants.MODE_VOLUME) and (newMode in @allowedModes or force)
      @arbitraryController?.stop()
      @planeController.start(newMode)

    else # newMode not allowed or invalid
      return


    for button in $("#view-mode .btn-group").children()

      $(button).removeClass("btn-primary")
      if newMode == @modeMapping[$(button).attr("id")]
        $(button).addClass("btn-primary")

    @mode = newMode
    @gui.setMode(newMode)
    @view.setMode(newMode)


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


  createGui : (restrictions, settings)->

    { model } = @

    gui = new Gui($("#optionswindow"), model, restrictions, settings)
    gui.update()  

    model.binary["color"].pullQueue.set4Bit(model.user.fourBit)
    model.binary["color"].updateContrastCurve(
      gui.settingsGeneral.brightness, gui.settingsGeneral.contrast)

    return gui
