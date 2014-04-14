### define
jquery : $
underscore : _
./controller/viewmodes/plane_controller : PlaneController
./controller/annotations/skeletontracing_controller : SkeletonTracingController
./controller/annotations/volumetracing_controller : VolumeTracingController
./controller/combinations/skeletontracing_arbitrary_controller : SkeletonTracingArbitraryController
./controller/combinations/skeletontracing_plane_controller : SkeletonTracingPlaneController
./controller/combinations/volumetracing_plane_controller : VolumeTracingPlaneController
./controller/scene_controller : SceneController
./controller/url_manager : UrlManager
./model : Model
./view : View
./view/skeletontracing/skeletontracing_view : SkeletonTracingView
./view/volumetracing/volumetracing_view : VolumeTracingView
../libs/event_mixin : EventMixin
../libs/input : Input
./view/gui : Gui
../libs/toast : Toast
./constants : constants
stats : Stats
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
  allowedModes : []


  constructor : (@controlMode) ->

    unless @browserSupported()
      unless window.confirm("You are using an unsupported browser, please use the newest version of Chrome, Opera or Safari.\n\nTry anyways?")
        window.history.back()

    _.extend(@, new EventMixin())

    @fullScreen = false
    @mode = constants.MODE_PLANE_TRACING

    @model = new Model()
    @urlManager = new UrlManager(this, @model)

    @model.initialize( @controlMode, @urlManager.initialState ).done ({restrictions, settings, error}) =>

      # Do not continue, when there was an error and we got no settings from the server
      if error
        return

      unless restrictions.allowAccess
        Toast.Error "You are not allowed to access this tracing"
        return

      @urlManager.startUrlUpdater()

      for allowedMode in settings.allowedModes
        @allowedModes.push switch allowedMode
          when "oxalis" then constants.MODE_PLANE_TRACING
          when "arbitrary" then constants.MODE_ARBITRARY
          when "volume" then constants.MODE_VOLUME

      if constants.MODE_ARBITRARY in @allowedModes
        @allowedModes.push(constants.MODE_ARBITRARY_PLANE)

      # FPS stats
      stats = new Stats()
      $("body").append stats.domElement

      @gui = @createGui(restrictions, settings)

      #TODO trigger on resize
      # set width / height for the right-side menu
      _.defer =>

        menuPosition = $("#right-menu").position()
        MARGIN = 40
        width = window.innerWidth - menuPosition.left - MARGIN
        height = window.innerHeight - menuPosition.top - MARGIN
        tabHeight = height - $('#right-menu .nav').height() - 30

        $("#right-menu").width(width).height(height)
        @annotationController?.abstractTreeController?.setDimensions({
          width : width
          height : tabHeight
        })

      @sceneController = new SceneController(
        @model.upperBoundary, @model.flycam, @model)


      if @model.skeletonTracing?

        @view = new SkeletonTracingView(@model)
        @annotationController = new SkeletonTracingController(
          @model, @sceneController, @gui, @view )
        @planeController = new SkeletonTracingPlaneController(
          @model, stats, @gui, @view, @sceneController, @annotationController)
        @arbitraryController = new SkeletonTracingArbitraryController(
          @model, stats, @gui, @view, @sceneController, @annotationController)

      else if @model.volumeTracing?

        @view = new VolumeTracingView(@model)
        @annotationController = new VolumeTracingController(
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
            @model.getSegmentationBinary().pingStop()
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
            $(this).blur()
            _controller.setMode( id )

        if not (id in @allowedModes)
          $(button).attr("disabled", "disabled")

      if @allowedModes.length == 1
        $("#view-mode").hide()

      @allowedModes.sort()
      if @allowedModes.length == 0
        Toast.error("There was no valid allowed tracing mode specified.")
      else
        @setMode( @allowedModes[0] )
      if @urlManager.initialState.mode?
        @setMode( @urlManager.initialState.mode )

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
          @annotationController?.abstractTreeController?.drawTree()

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

    gui = new Gui($("#optionswindow"), @model, restrictions, settings)
    gui.update()

    for binary in @model.getColorBinaries()
      binary.pullQueue.set4Bit(@model.user.get("fourBit"))

    return gui


  browserSupported : ->

    # right now only webkit-based browsers are supported
    return window.webkitURL
