### define 
./model/binary : Binary
./model/celltracing : CellTracing
./model/user : User
./model/volumetracing : VolumeTracing
./model/scaleinfo : ScaleInfo
./model/flycam2d : Flycam2d
./model/flycam3d : Flycam3d
../libs/request : Request
../libs/toast : Toast
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
      bytes += @binary[dataLayerName].queue.loadedBytes
      buckets += @binary[dataLayerName].queue.loadedBuckets
      totalBytes += @binary[dataLayerName].queue.totalLoadedBytes
      totalBuckets += @binary[dataLayerName].queue.totalLoadedBuckets
      @binary[dataLayerName].queue.loadedBytes = 0
      @binary[dataLayerName].queue.loadedBuckets = 0

    @bytes.push(bytes)
    @buckets.push(buckets)
    @totalBytes.push(totalBytes)
    @totalBuckets.push(totalBuckets)


  initialize : =>

    tracingId = $("#container").data("tracing-id")
    tracingType = $("#container").data("tracing-type")

    Request.send(
      url : "/annotations/#{tracingType}/#{tracingId}/info"
      dataType : "json"
    ).pipe (tracing) =>

      if tracing.error
        Toast.error(tracing.error)
        {"error": true}

      else unless tracing.content.dataSet
        Toast.error("Selected dataset doesnt exist")
        {"error": true}

      else
        Request.send(
          url : "/user/configuration"
          dataType : "json"
        ).pipe(
          (user) =>

            $.assertExtendContext({
              task: tracingId
              dataSet: tracing.content.dataSet.name
            })

            @user = new User(user)
            @scaleInfo = new ScaleInfo(tracing.content.dataSet.scale)

            # TODO: Define color bit depth
            supportedDataLayers = [{name: "color", allowManipulation : true},
                                    {name: "volume", allowManipulation : false},
                                    {name: "segmentation", allowManipulation : false}]            

            zoomStepCount = Infinity
            @binary = {}
            for layer in tracing.content.dataSet.dataLayers
              for supportedLayer in supportedDataLayers
                if layer.typ == supportedLayer.name
                  supportedLayer.bitDepth = parseInt( layer.elementClass.substring(4) )
                  @binary[layer.typ] = new Binary(@user, tracing.content.dataSet, constants.TEXTURE_SIZE_P, supportedLayer)
                  zoomStepCount = Math.min(zoomStepCount, @binary[layer.typ].cube.ZOOM_STEP_COUNT - 1)

            unless @binary["color"]?
              Toast.error("No data available! Something seems to be wrong with the dataset.")

            # if "volume" layer still used, change name to segmentation
            if @binary["volume"]?
              @binary["segmentation"] = @binary["volume"]
              delete @binary["volume"]

            @flycam = new Flycam2d(constants.PLANE_WIDTH, @scaleInfo, zoomStepCount, @user)      
            @flycam3d = new Flycam3d(constants.DISTANCE_3D, tracing.content.dataSet.scale)

            @flycam3d.on
              "changed" : (matrix) =>
                @flycam.setPosition([matrix[12], matrix[13], matrix[14]])
            @flycam.on
              "positionChanged" : (position) =>
                @flycam3d.setPositionSilent(position)
                
            @cellTracing = new CellTracing(tracing, @scaleInfo, @flycam, @flycam3d, @user)
            @volumeTracing = new VolumeTracing(@flycam, @binary["color"].cube)
            
            {"restrictions": tracing.restrictions, "settings": tracing.content.settings}
            
          -> Toast.error("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
        )