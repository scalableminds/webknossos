### define
jquery : $
underscore : _
app : app
backbone : Backbone
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
../libs/input : Input
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

  constructor : (options) ->

    { @model } = options

    _.extend(@,
      view : null
      planeController : null
      arbitraryController : null
      allowedModes : []
    )

    _.extend(@, Backbone.Events)

    unless @browserSupported()
      unless window.confirm("You are using an unsupported browser, please use the newest version of Chrome, Opera or Safari.\n\nTry anyways?")
        window.history.back()

    @fullScreen = false

    @urlManager = new UrlManager(@model)
    @model.set("state", @urlManager.initialState)

    @model.fetch()
      .done( (error) => @modelFetchDone(error) )
      .fail( (response) => @modelFetchFail(response) )

  modelFetchDone : (error) ->

    # Do not continue, when there was an error and we got no settings from the server
    if error
      return

    unless @model.tracing.restrictions.allowAccess
      Toast.Error "You are not allowed to access this tracing"
      return

    @urlManager.startUrlUpdater()

    for allowedMode in @model.settings.allowedModes

      @allowedModes.push switch allowedMode
        when "oxalis" then constants.MODE_PLANE_TRACING
        when "arbitrary" then constants.MODE_ARBITRARY
        when "volume" then constants.MODE_VOLUME

    if constants.MODE_ARBITRARY in @allowedModes
      @allowedModes.push(constants.MODE_ARBITRARY_PLANE)

    # FPS stats
    stats = new Stats()
    $("body").append stats.domElement

    @sceneController = new SceneController(
      @model.upperBoundary, @model.flycam, @model)


    if @model.skeletonTracing?

      @view = new SkeletonTracingView(@model)
      @annotationController = new SkeletonTracingController(
        @model, @sceneController, @view )
      @planeController = new SkeletonTracingPlaneController(
        @model, stats, @view, @sceneController, @annotationController)
      @arbitraryController = new SkeletonTracingArbitraryController(
        @model, stats, @view, @sceneController, @annotationController)

    else if @model.volumeTracing?

      @view = new VolumeTracingView(@model)
      @annotationController = new VolumeTracingController(
        @model, @sceneController, @view )
      @planeController = new VolumeTracingPlaneController(
        @model, stats, @view, @sceneController, @annotationController)

    else # View mode

      @view = new View(@model)
      @planeController = new PlaneController(
        @model, stats, @view, @sceneController)

    @initKeyboard()

    for binaryName of @model.binary
      @listenTo(@model.binary[binaryName].cube, "bucketLoaded", -> app.vent.trigger("rerender"))

    @listenTo(app.vent, "changeViewMode", @setMode)

    @allowedModes.sort()
    if @allowedModes.length == 0
      Toast.error("There was no valid allowed tracing mode specified.")
    else
      app.vent.trigger("changeViewMode", @allowedModes[0])
    if @urlManager.initialState.mode? and @urlManager.initialState.mode != @model.mode
      app.vent.trigger("changeViewMode", @urlManager.initialState.mode)

    # Zoom step warning
    @zoomStepWarningToast = null
    @model.flycam.on
      zoomStepChanged : =>
        shouldWarn = not @model.canDisplaySegmentationData()
        if shouldWarn and not @zoomStepWarningToast?
          toastType = if @model.volumeTracing? then "danger" else "info"
          @zoomStepWarningToast = Toast.message(toastType,
            "Segmentation data is only fully supported at a smaller zoom level.", true)
        else if not shouldWarn and @zoomStepWarningToast?
          @zoomStepWarningToast.remove()
          @zoomStepWarningToast = null


  modelFetchFail : (response) ->

    Toast.error(response.responseJSON.messages[0].error)


  initKeyboard : ->

    $(document).keypress (event) ->

      if $(event.target).is("input")
        # don't summon help modal when the user types into an input field
        return

      if event.shiftKey && event.which == 63
        $("#help-modal").modal('toggle')



    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or event.which == 18 or 37 <= event.which <= 40) and !$(":focus").length
      return

    keyboardControls = {
      "q" : => @toggleFullScreen()
    }

    if @model.get("controlMode") == constants.CONTROL_MODE_TRACE
      _.extend( keyboardControls, {
        #Set Mode, outcomment for release
        "shift + 1" : =>
          app.vent.trigger("changeViewMode", constants.MODE_PLANE_TRACING)
        "shift + 2" : =>
          app.vent.trigger("changeViewMode", constants.MODE_ARBITRARY)
        "shift + 3" : =>
          app.vent.trigger("changeViewMode", constants.MODE_ARBITRARY_PLANE)
        "shift + 4" : =>
          app.vent.trigger("changeViewMode", constants.MODE_VOLUME)

        "t" : =>
          @view.toggleTheme()

        "m" : => # rotate allowed modes

          index = (@allowedModes.indexOf(@model.mode) + 1) % @allowedModes.length
          app.vent.trigger("changeViewMode", @allowedModes[index])

        "super + s, ctrl + s" : (event) =>

          event.preventDefault()
          event.stopPropagation()
          @model.save()
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

    @model.mode = newMode


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


  browserSupported : ->

    # right now only webkit-based browsers are supported
    return window.webkitURL
