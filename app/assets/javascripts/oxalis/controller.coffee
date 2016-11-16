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
MinimalArbitraryController         = require("./controller/combinations/minimal_skeletontracing_arbitrary_controller")
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
    )

    _.extend(@, Backbone.Events)

    @fullScreen = false

    @urlManager = new UrlManager(@model)
    @model.set("state", @urlManager.initialState)

    @model.fetch()
        .then( => @modelFetchDone())
        .catch( (error) =>
          # Don't throw errors for errors already handled by the model.
          unless error == @model.HANDLED_ERROR
            throw error
        )


  modelFetchDone : ->

    unless @model.tracing.restrictions.allowAccess
      Toast.Error "You are not allowed to access this tracing"
      return

    app.router.on("beforeunload", =>
      if (@model.get("controlMode") == constants.CONTROL_MODE_TRACE)
        stateLogger = @model.annotationModel.stateLogger
        if not stateLogger.stateSaved() and stateLogger.allowUpdate
          stateLogger.pushNow()
          return "You haven't saved your progress, please give us 2 seconds to do so and and then leave this site."
    )

    @urlManager.startUrlUpdater()

    @sceneController = new SceneController(
      @model.upperBoundary, @model.flycam, @model)


    if @model.skeletonTracing?

      @view = new SkeletonTracingView(@model)
      @annotationController = new SkeletonTracingController(
        @model, @view, @sceneController)
      @planeController = new SkeletonTracingPlaneController(
        @model, @view, @sceneController, @annotationController)

      ArbitraryController = if @model.tracing.content.settings.advancedOptionsAllowed then SkeletonTracingArbitraryController else MinimalArbitraryController
      @arbitraryController = new ArbitraryController(
        @model, @view, @sceneController, @annotationController)

    else if @model.volumeTracing?

      @view = new VolumeTracingView(@model)
      @annotationController = new VolumeTracingController(
        @model, @view, @sceneController)
      @planeController = new VolumeTracingPlaneController(
        @model, @view, @sceneController, @annotationController)

    else # View mode

      @view = new View(@model)
      @planeController = new PlaneController(
        @model, @view, @sceneController)

    # FPS stats
    stats = new Stats()
    $("body").append stats.domElement
    @listenTo(@arbitraryController.arbitraryView, "render", -> stats.update()) if @arbitraryController
    @listenTo(@planeController.planeView, "render", -> stats.update())

    @initKeyboard()
    @initTimeLimit()

    for binaryName of @model.binary
      @listenTo(@model.binary[binaryName].cube, "bucketLoaded", -> app.vent.trigger("rerender"))


    @listenTo(@model, "change:mode", @loadMode)
    @loadMode(@model.get("mode"))


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

          index = (@model.allowedModes.indexOf(@model.get("mode")) + 1) % @model.allowedModes.length
          @model.setMode(@model.allowedModes[index])

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


  loadMode : (newMode, force = false) ->

    if (newMode == constants.MODE_ARBITRARY or newMode == constants.MODE_ARBITRARY_PLANE) and (newMode in @model.allowedModes or force)
      @planeController?.stop()
      @arbitraryController.start(newMode)

    else if (newMode == constants.MODE_PLANE_TRACING or newMode == constants.MODE_VOLUME) and (newMode in @model.allowedModes or force)
      @arbitraryController?.stop()
      @planeController.start(newMode)

    else # newMode not allowed or invalid
      return


  initTimeLimit :  ->

    # only enable hard time limit for anonymous users so far
    unless @model.tracing.task and @model.tracing.user.isAnonymous
      return

    # TODO move that somehwere else
    finishTracing = =>
      # save the progress
      model = @model

      tracingType = model.skeletonTracing || model.volumeTracing
      tracingType.stateLogger.pushNow().then( ->
        url = "/annotations/#{model.tracingType}/#{model.tracingId}/finishAndRedirect"
        app.router.loadURL(url)
      )

    # parse hard time limit and convert from min to ms
    expectedTime = @model.tracing.task.type.expectedTime
    timeLimit = expectedTime.maxHard * 60 * 1000 or 0

    # setTimeout uses signed 32-bit integers, an overflow would cause immediate timeout execution
    if timeLimit >= Math.pow(2, 32) / 2
      Toast.error("Time limit was reduced as it cannot be bigger than 35791 minutes.")
      timeLimit = Math.pow(2, 32) / 2 - 1
    console.log("TimeLimit is #{timeLimit/60/1000} min")

    if timeLimit
      setTimeout( ->
        window.alert("Time limit is reached, thanks for tracing!")
        finishTracing()
      , timeLimit)


module.exports = Controller
