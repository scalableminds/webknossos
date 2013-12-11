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

            dataSet = tracing.content.dataSet
            @user = new User(user)
            @scaleInfo = new ScaleInfo(dataSet.scale)

            supportedDataLayers = [{name: "color", bitDepth: 8, allowManipulation : true},
                                    {name: "volume", bitDepth: 16, allowManipulation : false},
                                    {name: "segmentation", bitDepth: 16, allowManipulation : false}]

            # For now, let's make sure we always have a segmentation layer
            unless _.find( dataSet.dataLayers, (layer) -> layer.typ == "segmentation" )?
              dataSet.dataLayers.push(
                maxCoordinates : dataSet.dataLayers[0].maxCoordinates
                resolutions : [0]
                typ : "segmentation"
                noData : true )   

            zoomStepCount = Infinity
            @binary = {}
            for layer in dataSet.dataLayers
              for supportedLayer in supportedDataLayers
                if layer.typ == supportedLayer.name
                  @binary[layer.typ] = new Binary(@user, dataSet, constants.TEXTURE_SIZE_P, supportedLayer)
                  zoomStepCount = Math.min(zoomStepCount, @binary[layer.typ].cube.ZOOM_STEP_COUNT - 1)

            unless @binary["color"]?
              Toast.error("No data available! Something seems to be wrong with the dataset.")

            # if "volume" layer still used, change name to segmentation
            if @binary["volume"]?
              @binary["segmentation"] = @binary["volume"]
              delete @binary["volume"]

            @flycam = new Flycam2d(constants.PLANE_WIDTH, @scaleInfo, zoomStepCount, @user)      
            @flycam3d = new Flycam3d(constants.DISTANCE_3D, dataSet.scale)

            @flycam3d.on
              "changed" : (matrix) =>
                @flycam.setPosition([matrix[12], matrix[13], matrix[14]])
            @flycam.on
              "positionChanged" : (position) =>
                @flycam3d.setPositionSilent(position)
                
            @cellTracing = new CellTracing(tracing, @scaleInfo, @flycam, @flycam3d, @user)
            if @binary["segmentation"]?
              @volumeTracing = new VolumeTracing(@flycam, @binary["segmentation"].cube)
            
            {"restrictions": tracing.restrictions, "settings": tracing.content.settings}
            
          -> Toast.error("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
        )