### define
backbone : Backbone
underscore : _
app : app
./model/binary : Binary
./model/skeletontracing/skeletontracing : SkeletonTracing
./model/user : User
./model/dataset : Dataset
./model/volumetracing/volumetracing : VolumeTracing
./model/binarydata_connection_info : ConnectionInfo
./model/scaleinfo : ScaleInfo
./model/flycam2d : Flycam2d
./model/flycam3d : Flycam3d
./constants : constants
libs/request : Request
libs/toast : Toast
libs/pipeline : Pipeline
###

# This is the model. It takes care of the data including the
# communication with the server.

# All public operations are **asynchronous**. We return a promise
# which you can react on.


class Model extends Backbone.Model


  fetch : (options) ->

    Request.send(
      url : "/annotations/#{@get("tracingType")}/#{@get("tracingId")}/info"
      dataType : "json"
    ).pipe (tracing) =>


      if tracing.error
        Toast.error(tracing.error)
        return {"error" : true}

      else unless tracing.content.dataSet
        Toast.error("Selected dataset doesn't exist")
        return {"error" : true}

      else unless tracing.content.dataSet.dataLayers
        datasetName = tracing.content.dataSet.name
        if datasetName
          Toast.error("Please, double check if you have the dataset '#{dataSetName}' imported.")
        else
          Toast.error("Please, make sure you have a dataset imported.")
        return {"error" : true}

      else

        @user = new User()
        @user.fetch().pipe( =>

          @set("dataset", new Dataset(tracing.content.dataSet))
          @get("dataset").fetch().pipe( =>

            layers  = @getLayers(tracing.content.contentData.customLayers)

            $.when(
              @getDataTokens(layers)...
            ).pipe =>
              @initializeWithData(tracing, layers)

          -> Toast.error("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
          )
        )


  initializeWithData : (tracing, layers) ->

    dataset = @get("dataset")

    $.assertExtendContext({
      task: @get("tracingId")
      dataSet: dataset.get("name")
    })

    console.log "tracing", tracing
    console.log "user", @user

    isVolumeTracing = "volume" in tracing.content.settings.allowedModes
    app.scaleInfo = new ScaleInfo(dataset.get("scale"))
    @updatePipeline = new Pipeline([tracing.version])

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
    @datasetName = dataset.name
    @binary = {}

    maxResolution = Math.max(_.union(layers.map((layer) ->
      layer.resolutions
    )...)...)
    maxZoomStep = Math.log(maxResolution) / Math.LN2

    for layer in layers
      layer.bitDepth = parseInt(layer.elementClass.substring(4))
      @binary[layer.name] = new Binary(this, tracing, layer, maxZoomStep, @updatePipeline, @connectionInfo)

    if @getColorBinaries().length == 0
      Toast.error("No data available! Something seems to be wrong with the dataset.")

    @setDefaultBinaryColors()

    flycam = new Flycam2d(constants.PLANE_WIDTH, maxZoomStep + 1, @)
    flycam3d = new Flycam3d(constants.DISTANCE_3D, dataset.get("scale"))
    @set("flycam", flycam)
    @set("flycam3d", flycam3d)
    @listenTo(flycam3d, "changed", (matrix, zoomStep) => flycam.setPosition(matrix[12..14]))
    @listenTo(flycam, "positionChanged" : (position) => flycam3d.setPositionSilent(position))

    # init state
    state = @get("state")
    flycam.setPosition( state.position || tracing.content.editPosition )
    if state.zoomStep?
      flycam.setZoomStep( state.zoomStep )
      flycam3d.setZoomStep( state.zoomStep )
    if state.rotation?
      flycam3d.setRotation( state.rotation )

    if @get("controlMode") == constants.CONTROL_MODE_TRACE

      if isVolumeTracing
        $.assert( @getSegmentationBinary()?,
          "Volume is allowed, but segmentation does not exist" )
        @set("volumeTracing", new VolumeTracing(tracing, flycam, @getSegmentationBinary(), @updatePipeline))

      else
        @set("skeletonTracing", new SkeletonTracing(tracing, flycam, flycam3d, @user, @updatePipeline))

    @computeBoundaries()

    @set("tracing", tracing)
    @set("settings", tracing.content.settings)
    @set("mode", if isVolumeTracing then constants.MODE_VOLUME else constants.MODE_PLANE_TRACING)

    @initSettersGetter()
    @trigger("sync")

    return

  getDataTokens : (layers) ->

    dataStoreUrl = @get("dataset").get("dataStore").url
    dataSetName = @get("dataset").get("name")

    for layer in layers
      do (layer) ->
        Request.send(
          url : "/dataToken/generate?dataSetName=#{dataSetName}&dataLayerName=#{layer.name}"
          dataType : "json"
        ).pipe (dataStore) ->
          layer.token = dataStore.token
          layer.url   = dataStoreUrl


  getColorBinaries : ->

    return _.filter(@binary, (binary) ->
      binary.category == "color"
    )


  getSegmentationBinary : ->

    return _.find(@binary, (binary) ->
      binary.category == "segmentation"
    )


  setDefaultBinaryColors : ->

    dataset = @get("dataset")
    layerColors = dataset.get("layerColors")
    colorBinaries = @getColorBinaries()

    if colorBinaries.length == 1
      defaultColors = [[255, 255, 255]]
    else
      defaultColors = [[255, 0, 0], [0, 255, 0], [0, 0, 255],
                        [255, 255, 0], [0, 255, 255], [255, 0, 255]]

    for binary, i in colorBinaries
      if layerColors[binary.name]
        color = layerColors[binary.name]
      else
        color = defaultColors[i % defaultColors.length]
      dataset.set("layerColors.#{binary.name}", color)


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
