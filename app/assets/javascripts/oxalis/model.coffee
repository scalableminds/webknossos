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
Request              = require("libs/request")
Toast                = require("libs/toast")
ErrorHandling        = require("libs/error_handling")

# This is THE model. It takes care of the data including the
# communication with the server.

# All public operations are **asynchronous**. We return a promise
# which you can react on.


class Model extends Backbone.Model

  fetch : (options) ->

    if @get("controlMode") == constants.CONTROL_MODE_TRACE
      # Include /readOnly part whenever it is in the pathname
      infoUrl = location.pathname + "/info"
    else
      infoUrl = "/annotations/#{@get('tracingType')}/#{@get('tracingId')}/info"

    Request.receiveJSON(infoUrl).then( (tracing) =>

      @datasetName = tracing.content.dataSet.name

      if tracing.error
        Toast.error(tracing.error)
        return {"error" : true}

      else unless tracing.content.dataSet
        Toast.error("Selected dataset doesn't exist")
        return {"error" : true}

      else unless tracing.content.dataSet.dataLayers
        if @datasetName
          Toast.error("Please, double check if you have the dataset '#{@datasetName}' imported.")
        else
          Toast.error("Please, make sure you have a dataset imported.")
        return {"error" : true}

      else

        @user = new User()
        @set("user", @user)

        @user.fetch().then( =>

          @set("dataset", new Backbone.Model(tracing.content.dataSet))
          colorLayers = _.filter( @get("dataset").get("dataLayers"),
                                  (layer) -> layer.category == "color")
          @set("datasetConfiguration", new DatasetConfiguration({
            @datasetName
            dataLayerNames : _.pluck(colorLayers, "name")
          }))
          @get("datasetConfiguration").fetch().then(
            =>
              layers = @getLayers(tracing.content.contentData.customLayers)

              Promise.all(
                @getDataTokens(layers)
              ).then( =>
                error = @initializeWithData(tracing, layers)
                return error if error
              )

            -> Toast.error("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
            )
        )
      )


  initializeWithData : (tracing, layers) ->

    dataset = @get("dataset")

    ErrorHandling.assertExtendContext({
      task: @get("tracingId")
      dataSet: dataset.get("name")

    })

    console.log "tracing", tracing
    console.log "user", @user

    isVolumeTracing = "volume" in tracing.content.settings.allowedModes
    app.scaleInfo = new ScaleInfo(dataset.get("scale"))

    if (bb = tracing.content.boundingBox)?
        @boundingBox = {
          min : bb.topLeft
          max : [
            bb.topLeft[0] + bb.width
            bb.topLeft[1] + bb.height
            bb.topLeft[2] + bb.depth
          ]
        }

    @connectionInfo = new ConnectionInfo()
    @binary = {}

    maxZoomStep = -Infinity

    for layer in layers
      layer.bitDepth = parseInt(layer.elementClass.substring(4))
      maxLayerZoomStep = Math.log(Math.max(layer.resolutions...)) / Math.LN2
      @binary[layer.name] = new Binary(this, tracing, layer, maxLayerZoomStep, @connectionInfo)
      maxZoomStep = Math.max(maxZoomStep, maxLayerZoomStep)

    @buildMappingsObject(layers)

    if @getColorBinaries().length == 0
      Toast.error("No data available! Something seems to be wrong with the dataset.")
      return {"error" : true}

    flycam = new Flycam2d(constants.PLANE_WIDTH, maxZoomStep + 1, @)
    flycam3d = new Flycam3d(constants.DISTANCE_3D, dataset.get("scale"))
    @set("flycam", flycam)
    @set("flycam3d", flycam3d)
    @listenTo(flycam3d, "changed", (matrix, zoomStep) => flycam.setPosition(matrix[12..14]))
    @listenTo(flycam, "positionChanged" : (position) => flycam3d.setPositionSilent(position))

    if @get("controlMode") == constants.CONTROL_MODE_TRACE

      if isVolumeTracing
        ErrorHandling.assert( @getSegmentationBinary()?,
          "Volume is allowed, but segmentation does not exist" )
        @set("volumeTracing", new VolumeTracing(tracing, flycam, @getSegmentationBinary()))
      else
        @set("skeletonTracing", new SkeletonTracing(tracing, flycam, flycam3d, @user))

    @applyState(@get("state"), tracing)
    @computeBoundaries()

    @set("tracing", tracing)
    @set("settings", tracing.content.settings)
    @set("mode", if isVolumeTracing then constants.MODE_VOLUME else constants.MODE_PLANE_TRACING)

    @initSettersGetter()
    @trigger("sync")

    # no error
    return


  setMode : (@mode) ->

    @trigger("change:mode", @mode)


  # For now, since we have no UI for this
  buildMappingsObject : (layers) ->

    segmentationBinary = @getSegmentationBinary()

    if segmentationBinary?
      window.mappings = {
        getAll : => segmentationBinary.mappings.getMappingNames()
        getActive : => segmentationBinary.activeMapping
        activate : (mapping) => segmentationBinary.setActiveMapping(mapping)
      }


  getDataTokens : (layers) ->

    dataStoreUrl = @get("dataset").get("dataStore").url

    for layer in layers
      do (layer) =>
        Request.receiveJSON("/dataToken/generate?dataSetName=#{@datasetName}&dataLayerName=#{layer.name}").then( (dataStore) ->
          layer.token = dataStore.token
          layer.url   = dataStoreUrl
        )


  getColorBinaries : ->

    return _.filter(@binary, (binary) ->
      binary.category == "color"
    )


  getSegmentationBinary : ->

    return _.find(@binary, (binary) ->
      binary.category == "segmentation"
    )


  getLayers : (userLayers) ->
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
    deferreds = []

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
      deferreds.push( model.save() )
    )

    return $.when.apply($, deferreds)


  # Make the Model compatible between legacy Oxalis style and Backbone.Modela/Views
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

    @get("flycam").setPosition( state.position || tracing.content.editPosition )
    if state.zoomStep?
      @get("user").set("zoom", Math.exp(Math.LN2 * state.zoomStep))
      @get("flycam3d").setZoomStep( state.zoomStep )
    if state.rotation?
      @get("flycam3d").setRotation( state.rotation )
    if state.activeNode?
      @get("skeletonTracing")?.setActiveNode(state.activeNode)


module.exports = Model
