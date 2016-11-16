Backbone             = require("backbone")
_                    = require("lodash")
app                  = require("../app")
Binary               = require("./model/binary")
SkeletonTracing      = require("./model/skeletontracing/skeletontracing")
User                 = require("./model/user")
DatasetConfiguration = require("./model/dataset_configuration")
VolumeTracing        = require("./model/volumetracing/volumetracing")
ConnectionInfo       = require("./model/binarydata_connection_info")
ScaleInfo            = require("./model/scaleinfo")
Flycam2d             = require("./model/flycam2d")
Flycam3d             = require("./model/flycam3d")
constants            = require("./constants")
Request              = require("../libs/request")
Toast                = require("../libs/toast")
ErrorHandling        = require("../libs/error_handling")
WkLayer              = require("./model/binary/layers/wk_layer")
NdStoreLayer         = require("./model/binary/layers/nd_store_layer")

# This is THE model. It takes care of the data including the
# communication with the server.

# All public operations are **asynchronous**. We return a promise
# which you can react on.


class Model extends Backbone.Model


  HANDLED_ERROR : {}


  constructor : ->

    @initialized = false
    super(arguments...)


  fetch : (options) ->

    if @get("controlMode") == constants.CONTROL_MODE_TRACE
      # Include /readOnly part whenever it is in the pathname
      infoUrl = location.pathname + "/info"
    else
      infoUrl = "/annotations/#{@get('tracingType')}/#{@get('tracingId')}/info"

    Request.receiveJSON(infoUrl).then( (tracing) =>

      if tracing.error
        error = tracing.error

      else unless tracing.content.dataSet
        error = "Selected dataset doesn't exist"

      else unless tracing.content.dataSet.dataLayers
        if datasetName = tracing.content.dataSet.name
          error = "Please, double check if you have the dataset '#{datasetName}' imported."
        else
          error = "Please, make sure you have a dataset imported."

      if error
        Toast.error(error)
        throw @HANDLED_ERROR

      @user = new User()
      @set("user", @user)
      @set("datasetName", tracing.content.dataSet.name)

      return @user.fetch().then(-> Promise.resolve(tracing))

    ).then( (tracing) =>

      @set("dataset", new Backbone.Model(tracing.content.dataSet))
      colorLayers = _.filter( @get("dataset").get("dataLayers"),
                              (layer) -> layer.category == "color")
      @set("datasetConfiguration", new DatasetConfiguration({
        datasetName : @get("datasetName")
        dataLayerNames : _.map(colorLayers, "name")
      }))
      return @get("datasetConfiguration").fetch().then(-> Promise.resolve(tracing))

    ).then( (tracing) =>

      layerInfos = @getLayerInfos(tracing.content.contentData.customLayers)
      @initializeWithData(tracing, layerInfos)

    )


  determineAllowedModes : ->

    allowedModes = []
    settings = @get("settings")
    for allowedMode in settings.allowedModes

      if @getColorBinaries()[0].cube.BIT_DEPTH == 8
        switch allowedMode
          when "flight" then allowedModes.push(constants.MODE_ARBITRARY)
          when "oblique" then allowedModes.push(constants.MODE_ARBITRARY_PLANE)

      if allowedMode in ["orthogonal", "volume"]
        allowedModes.push(constants.MODE_NAME_TO_ID[allowedMode])

    if settings.preferredMode
      modeId = constants.MODE_NAME_TO_ID[settings.preferredMode]
      if modeId in allowedModes
        @set("preferredMode", modeId)

    allowedModes.sort()
    return allowedModes


  initializeWithData : (tracing, layerInfos) ->

    dataStore = tracing.content.dataSet.dataStore
    dataset = @get("dataset")

    LayerClass = switch dataStore.typ
      when "webknossos-store" then WkLayer
      when "ndstore" then NdStoreLayer
      else throw new Error("Unknown datastore type: #{dataStore.typ}")

    layers = layerInfos.map((layerInfo) ->
      new LayerClass(layerInfo, dataset.get("name"), dataStore)
    )

    ErrorHandling.assertExtendContext({
      task : @get("tracingId")
      dataSet : dataset.get("name")
    })

    console.log "tracing", tracing
    console.log "user", @user

    isVolumeTracing = "volume" in tracing.content.settings.allowedModes
    app.scaleInfo = new ScaleInfo(dataset.get("scale"))

    if (bb = tracing.content.boundingBox)?
      @taskBoundingBox = @computeBoundingBoxFromArray(bb.topLeft.concat([bb.width, bb.height, bb.depth]))

    @connectionInfo = new ConnectionInfo()
    @binary = {}

    maxZoomStep = -Infinity

    for layer in layers
      maxLayerZoomStep = Math.log(Math.max(layer.resolutions...)) / Math.LN2
      @binary[layer.name] = new Binary(this, tracing, layer, maxLayerZoomStep, @connectionInfo)
      maxZoomStep = Math.max(maxZoomStep, maxLayerZoomStep)

    @buildMappingsObject()

    if @getColorBinaries().length == 0
      Toast.error("No data available! Something seems to be wrong with the dataset.")
      throw @HANDLED_ERROR

    flycam = new Flycam2d(constants.PLANE_WIDTH, maxZoomStep + 1, @)
    flycam3d = new Flycam3d(constants.DISTANCE_3D, dataset.get("scale"))
    @set("flycam", flycam)
    @set("flycam3d", flycam3d)
    @listenTo(flycam3d, "changed", (matrix, zoomStep) -> flycam.setPosition(matrix[12..14]))
    @listenTo(flycam, "positionChanged" : (position) -> flycam3d.setPositionSilent(position))

    if @get("controlMode") == constants.CONTROL_MODE_TRACE

      if isVolumeTracing
        ErrorHandling.assert( @getSegmentationBinary()?,
          "Volume is allowed, but segmentation does not exist" )
        @set("volumeTracing", new VolumeTracing(tracing, flycam, flycam3d, @getSegmentationBinary()))
        @annotationModel = @get("volumeTracing")
      else
        @set("skeletonTracing", new SkeletonTracing(tracing, flycam, flycam3d, @user))
        @annotationModel = @get("skeletonTracing")

    @applyState(@get("state"), tracing)
    @computeBoundaries()

    @set("tracing", tracing)
    @set("flightmodeRecording", false)
    @set("settings", tracing.content.settings)
    @set("allowedModes", @determineAllowedModes())
    @set("isTask", @get("tracingType") == "Task")


    # Initialize 'flight', 'oblique' or 'orthogonal'/'volume' mode
    if @get("allowedModes").length == 0
      Toast.error("There was no valid allowed tracing mode specified.")
    else
      mode = @get("preferredMode") or @get("state").mode or @get("allowedModes")[0]
      @setMode(mode)


    @initSettersGetter()
    @initialized = true
    @trigger("sync")

    # no error
    return


  setMode : (mode) ->

    @set("mode", mode)
    @trigger("change:mode", mode)


  setUserBoundingBox : (bb) ->

    @userBoundingBox = @computeBoundingBoxFromArray(bb)
    @trigger("change:userBoundingBox", @userBoundingBox)


  computeBoundingBoxFromArray : (bb) ->

    [x, y, z, width, height, depth] = bb

    return {
      min : [x, y, z]
      max : [x + width, y + height, z + depth]
    }


  # For now, since we have no UI for this
  buildMappingsObject : ->

    segmentationBinary = @getSegmentationBinary()

    if segmentationBinary?
      window.mappings = {
        getAll : -> segmentationBinary.mappings.getMappingNames()
        getActive : -> segmentationBinary.activeMapping
        activate : (mapping) -> segmentationBinary.setActiveMapping(mapping)
      }


  getColorBinaries : ->

    return _.filter(@binary, (binary) ->
      binary.category == "color"
    )


  getSegmentationBinary : ->

    return _.find(@binary, (binary) ->
      binary.category == "segmentation"
    )


  getLayerInfos : (userLayers) ->
    # Overwrite or extend layers with userLayers

    layers = @get("dataset").get("dataLayers")
    return layers unless userLayers?

    for userLayer in userLayers

      layer = _.find layers, (layer) ->
        layer.name == userLayer.fallback?.layerName

      if layer?
        _.extend layer, userLayer
      else
        layers.push(userLayer)

    return layers


  canDisplaySegmentationData : ->

    return not @flycam.getIntegerZoomStep() > 0 or not @getSegmentationBinary()


  computeBoundaries : ->

    @lowerBoundary = [ Infinity,  Infinity,  Infinity]
    @upperBoundary = [-Infinity, -Infinity, -Infinity]

    for key, binary of @binary
      for i in [0..2]
        @lowerBoundary[i] = Math.min @lowerBoundary[i], binary.lowerBoundary[i]
        @upperBoundary[i] = Math.max @upperBoundary[i], binary.upperBoundary[i]

  # delegate save request to all submodules
  save : ->

    submodels = []
    promises = []

    if @user?
      submodels.push[@user]

    if @get("dataset")?
      submodels.push[@get("dataset")]

    if @get("datasetConfiguration")?
      submodels.push[@get("datasetConfiguration")]

    if @get("volumeTracing")?
      submodels.push(@get("volumeTracing").stateLogger)

    if @get("skeletonTracing")?
      submodels.push(@get("skeletonTracing").stateLogger)

    _.each(submodels, (model) ->
      promises.push( model.save() )
    )

    return Promise.all(promises).then(
      ->
        Toast.success("Saved!")
        return Promise.resolve(arguments)
      ->
        Toast.error("Couldn't save. Please try again.")
        return Promise.reject(arguments)
    )


  # Make the Model compatible between legacy Oxalis style and Backbone.Models/Views
  initSettersGetter : ->

    _.forEach(@attributes, (value, key, attribute) =>

      Object.defineProperty(@, key,
        set : (val) ->
          this.set(key, val)
        , get : ->
          return @get(key)
      )
    )


  applyState : (state, tracing) ->

    @get("flycam").setPosition(state.position || tracing.content.editPosition)
    if state.zoomStep?
      @get("user").set("zoom", Math.exp(Math.LN2 * state.zoomStep))
      @get("flycam3d").setZoomStep( state.zoomStep )

    rotation = state.rotation || tracing.content.editRotation
    if rotation?
      @get("flycam3d").setRotation(rotation)

    if state.activeNode?
      @get("skeletonTracing")?.setActiveNode(state.activeNode)


module.exports = Model
