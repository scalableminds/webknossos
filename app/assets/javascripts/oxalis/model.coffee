### define
app : app
./model/binary : Binary
./model/skeletontracing/skeletontracing : SkeletonTracing
./model/user : User
./model/dataset : Dataset
./model/volumetracing/volumetracing : VolumeTracing
./model/scaleinfo : ScaleInfo
./model/flycam2d : Flycam2d
./model/flycam3d : Flycam3d
libs/request : Request
libs/toast : Toast
./constants : constants
###

# This is the model. It takes care of the data including the
# communication with the server.

# All public operations are **asynchronous**. We return a promise
# which you can react on.


class Model

  timestamps : []
  buckets : []
  bytes : []
  totalBuckets : []
  totalBytes : []


  logConnectionInfo : =>

    @timestamps.push(new Date().getTime())

    bytes = 0
    buckets = 0
    totalBytes = 0
    totalBuckets = 0

    for dataLayerName of @binary
      bytes += @binary[dataLayerName].pullQueue.loadedBytes
      buckets += @binary[dataLayerName].pullQueue.loadedBuckets
      totalBytes += @binary[dataLayerName].pullQueue.totalLoadedBytes
      totalBuckets += @binary[dataLayerName].pullQueue.totalLoadedBuckets
      @binary[dataLayerName].pullQueue.loadedBytes = 0
      @binary[dataLayerName].pullQueue.loadedBuckets = 0

    @bytes.push(bytes)
    @buckets.push(buckets)
    @totalBytes.push(totalBytes)
    @totalBuckets.push(totalBuckets)


  initialize : (options) =>

    {tracingId, tracingType, controlMode, state} = options

    Request.send(
      url : "/annotations/#{tracingType}/#{tracingId}/info"
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
        @user = new User()
        @user.fetch().pipe( =>

          @dataset = new Dataset(tracing.content.dataSet.name)
          @dataset.fetch().pipe( =>

            $.assertExtendContext({
              task: tracingId
              dataSet: tracing.content.dataSet.name
            })

            console.log "tracing", tracing
            console.log "user", @user

            dataset = tracing.content.dataSet
            @scaleInfo = new ScaleInfo(dataset.scale)

            if (bb = tracing.content.boundingBox)?
                @boundingBox = {
                  min : bb.topLeft
                  max : [
                    bb.topLeft[0] + bb.width
                    bb.topLeft[1] + bb.height
                    bb.topLeft[2] + bb.depth
                  ]
                }

            @datasetName = dataset.name
            zoomStepCount = Infinity
            @binary = {}
            @lowerBoundary = [ Infinity,  Infinity,  Infinity]
            @upperBoundary = [-Infinity, -Infinity, -Infinity]

            for layer in @getLayers(dataset.dataLayers, tracing.content.contentData.customLayers)

              layer.bitDepth = parseInt(layer.elementClass.substring(4), 10)
              @binary[layer.name] = new Binary(this, tracing, layer, tracingId)
              zoomStepCount = Math.min(zoomStepCount, @binary[layer.name].cube.ZOOM_STEP_COUNT - 1)

              for i in [0..2]
                @lowerBoundary[i] = Math.min @lowerBoundary[i], @binary[layer.name].lowerBoundary[i]
                @upperBoundary[i] = Math.max @upperBoundary[i], @binary[layer.name].upperBoundary[i]

            if @getColorBinaries().length == 0
              Toast.error("No data available! Something seems to be wrong with the dataset.")
            @setDefaultBinaryColors()

            @flycam = new Flycam2d(constants.PLANE_WIDTH, @scaleInfo, zoomStepCount, @user)
            @flycam3d = new Flycam3d(constants.DISTANCE_3D, dataset.scale)

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

              if "volume" in tracing.content.settings.allowedModes
                $.assert( @getSegmentationBinary()?,
                  "Volume is allowed, but segmentation does not exist" )
                @volumeTracing = new VolumeTracing(tracing, @flycam, @getSegmentationBinary().cube)

              else
                @skeletonTracing = new SkeletonTracing(tracing, @scaleInfo, @flycam, @flycam3d, @user)

            @restrictions = tracing.restrictions

            app.vent.trigger("model:sync")
            return {"restrictions": tracing.restrictions, "settings": tracing.content.settings}


          -> Toast.error("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
          )
        )


  getColorBinaries : ->

    return _.filter(@binary, (binary) ->
      binary.category == "color"
    )


  getSegmentationBinary : ->

    return _.find(@binary, (binary) ->
      binary.category == "segmentation"
    )


  setDefaultBinaryColors : ->

    layerColors = @dataset.get("layerColors")
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
      @dataset.set("layerColors.#{binary.name}", color)


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
