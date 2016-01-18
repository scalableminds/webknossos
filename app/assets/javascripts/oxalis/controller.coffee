$                                  = require("jquery")
_                                  = require("lodash")
app                                = require("../app")
Backbone                           = require("backbone")
Stats                              = require("stats.js")
PlaneController                    = require("./controller/viewmodes/plane_controller")
SkeletonTracingController          = require("./controller/annotations/skeletontracing_controller")
VolumeTracingController            = require("./controller/annotations/volumetracing_controller")
SkeletonTracingArbitraryController = require("./controller/combinations/skeletontracing_arbitrary_controller")
SkeletonTracingPlaneController     = require("./controller/combinations/skeletontracing_plane_controller")
VolumeTracingPlaneController       = require("./controller/combinations/volumetracing_plane_controller")
SceneController                    = require("./controller/scene_controller")
UrlManager                         = require("./controller/url_manager")
Model                              = require("./model")
View                               = require("./view")
SkeletonTracingView                = require("./view/skeletontracing/skeletontracing_view")
VolumeTracingView                  = require("./view/volumetracing/volumetracing_view")
constants                          = require("./constants")
Input                              = require("../libs/input")
Toast                              = require("../libs/toast")


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

    @fullScreen = false

    @urlManager = new UrlManager(@model)
    @model.set("state", @urlManager.initialState)

    @model.fetch()
      .then(
        (error) => @modelFetchDone(error)
      )


  modelFetchDone : (error) ->

    # Do not continue, when there was an error and we got no settings from the server
    if error
      return

    unless @model.tracing.restrictions.allowAccess
      Toast.Error "You are not allowed to access this tracing"
      return

    @urlManager.startUrlUpdater()

    for allowedMode in @model.settings.allowedModes

      if @model.getColorBinaries()[0].cube.BIT_DEPTH == 8
        switch allowedMode
          when "flight" then @allowedModes.push(constants.MODE_ARBITRARY)
          when "oblique" then @allowedModes.push(constants.MODE_ARBITRARY_PLANE)

      switch allowedMode
        when "volume" then @allowedModes.push(constants.MODE_VOLUME)

    if not @model.volumeTracing?
      # Plane tracing mode is always allowed (except in VOLUME mode)
      @allowedModes.push(constants.MODE_PLANE_TRACING)


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

    @listenTo(@model, "change:mode", @setMode)

    @allowedModes.sort()
    if @allowedModes.length == 0
      Toast.error("There was no valid allowed tracing mode specified.")
    else
      @model.setMode(@allowedModes[0])
    if @urlManager.initialState.mode? and @urlManager.initialState.mode != @model.mode
      @model.setMode(@urlManager.initialState.mode)


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


  initKeyboard : ->

    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or event.which == 18 or 37 <= event.which <= 40) and !$(":focus").length
      return

    keyboardControls = {}

    if @model.get("controlMode") == constants.CONTROL_MODE_TRACE
      _.extend( keyboardControls, {
        #Set Mode, outcomment for release
        "shift + 1" : =>
          @model.setMode(constants.MODE_PLANE_TRACING)
        "shift + 2" : =>
          @model.setMode(constants.MODE_ARBITRARY)
        "shift + 3" : =>
          @model.setMode(constants.MODE_ARBITRARY_PLANE)

        "t" : =>
          @view.toggleTheme()

        "m" : => # rotate allowed modes

          index = (@allowedModes.indexOf(@model.get("mode")) + 1) % @allowedModes.length
          @model.setMode(@allowedModes[index])

        "super + s" : (event) =>
          event.preventDefault()
          event.stopPropagation()
          @model.save()

        "ctrl + s" : (event) =>
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


module.exports = Controller
