### define
./model/binary : Binary
./model/skeletontracing/skeletontracing : SkeletonTracing
./model/user : User
./model/volumetracing/volumetracing : VolumeTracing
./model/binarydata_connection_info : ConnectionInfo
./model/scaleinfo : ScaleInfo
./model/flycam2d : Flycam2d
./model/flycam3d : Flycam3d
libs/request : Request
libs/toast : Toast
libs/pipeline : Pipeline
./constants : constants
###

# This is the model. It takes care of the data including the
# communication with the server.

# All public operations are **asynchronous**. We return a promise
# which you can react on.


class Model

  initialize : (controlMode, state) =>

    @tracingId = $("#container").data("tracing-id")
    @tracingType = $("#container").data("tracing-type")

    Request.send(
      url : "/annotations/#{@tracingType}/#{@tracingId}/info"
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
          Toast.error("Please, double check if you have the dataset '#{datasetName}' imported.")
        else
          Toast.error("Please, make sure you have a dataset imported.")
        return {"error" : true}

      else
        Request.send(
          url : "/user/configuration"
          dataType : "json"
        ).pipe(
          (user) =>
            dataSet = tracing.content.dataSet
            layers  = @getLayers(dataSet.dataLayers, tracing.content.contentData.customLayers)
            $.when(
              @getDataTokens(dataSet.dataStore.url, dataSet.name, layers)...
            ).pipe =>
              @initializeWithData(controlMode, state, tracing, user, layers)

          -> Toast.error("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
        )

  initializeWithData : (controlMode, state, tracing, user, layers) ->

    $.assertExtendContext({
      task: tracing.id
      dataSet: tracing.content.dataSet.name
    })

    console.log "tracing", tracing
    console.log "user", user

    dataSet = tracing.content.dataSet
    isVolumeTracing = "volume" in tracing.content.settings.allowedModes
    @user = new User(user)
    @scaleInfo = new ScaleInfo(dataSet.scale)
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
    @dataSetName = dataSet.name
    @datasetPostfix = _.last(@dataSetName.split("_"))
    @binary = {}

    maxResolution = Math.max(_.union(layers.map((layer) ->
      layer.resolutions
    )...)...)
    maxZoomStep = Math.log(maxResolution) / Math.LN2

    for layer in layers
      layer.bitDepth = parseInt(layer.elementClass.substring(4))
      @binary[layer.name] = new Binary(this, tracing, layer, maxZoomStep, @updatePipeline, @connectionInfo)
      zoomStepCount = Math.max(zoomStepCount, @binary[layer.name].cube.ZOOM_STEP_COUNT - 1)

    if @getColorBinaries().length == 0
      Toast.error("No data available! Something seems to be wrong with the dataset.")

    @setDefaultBinaryColors()

    @flycam = new Flycam2d(constants.PLANE_WIDTH, @scaleInfo, maxZoomStep + 1, @user)
    @flycam3d = new Flycam3d(constants.DISTANCE_3D, dataSet.scale)
    @flycam3d.on
      "changed" : (matrix, zoomStep) =>
        @flycam.setPosition( matrix[12..14] )
    @flycam.on
      "positionChanged" : (position) =>
        @flycam3d.setPositionSilent(position)

    # init state
    @flycam.setPosition( state.position || tracing.content.editPosition )
    if state.zoomStep?
      @flycam.setZoomStep( state.zoomStep )
      @flycam3d.setZoomStep( state.zoomStep )
    if state.rotation?
      @flycam3d.setRotation( state.rotation )

    if controlMode == constants.CONTROL_MODE_TRACE

      if isVolumeTracing
        $.assert( @getSegmentationBinary()?,
          "Volume is allowed, but segmentation does not exist" )
        @volumeTracing = new VolumeTracing(tracing, @flycam, @getSegmentationBinary(), @updatePipeline)
      else
        @skeletonTracing = new SkeletonTracing(tracing, @scaleInfo, @flycam, @flycam3d, @user, @updatePipeline)

    @computeBoundaries()

    {"restrictions": tracing.restrictions, "settings": tracing.content.settings}


  getDataTokens : (dataStoreUrl, dataSetName, layers) ->

    for layer in layers
      do (layer) ->
        Request.send(
          url : "/dataToken/generate?dataSetName=#{dataSetName}&dataLayerName=#{layer.name}"
          dataType : "json"
        ).pipe (dataStore) ->
          layer.token = dataStore.token
          layer.url   = dataStoreUrl


  getColorBinaries : ->

    return _.filter @binary, (binary) ->
      binary.category == "color"


  getSegmentationBinary : ->

    return _.find @binary, (binary) ->
      binary.category == "segmentation"


  setDefaultBinaryColors : ->

    colorBinaries = @getColorBinaries()

    if colorBinaries.length == 1
      defaultColors = [[255, 255, 255]]
    else
      defaultColors = [[255, 0, 0], [0, 255, 0], [0, 0, 255],
                        [255, 255, 0], [0, 255, 255], [255, 0, 255]]

    for binary, i in colorBinaries
      binary.setColor( defaultColors[i % defaultColors.length] )


  getLayers : (layers, userLayers) ->
    # Overwrite or extend layers with userLayers

    return layers unless userLayers?

    for userLayer in userLayers

      layer = _.find layers, (layer) ->
        layer.name == userLayer.fallback?.layerName

      if layer?
        _.extend layer, userLayer
      else
        layers.push(userLayer)

    return layers


  computeBoundaries : ->

    @lowerBoundary = [ Infinity,  Infinity,  Infinity]
    @upperBoundary = [-Infinity, -Infinity, -Infinity]

    for key, binary of @binary
      for i in [0..2]
        @lowerBoundary[i] = Math.min @lowerBoundary[i], binary.lowerBoundary[i]
        @upperBoundary[i] = Math.max @upperBoundary[i], binary.upperBoundary[i]
