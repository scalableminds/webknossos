### define 
./model/binary : Binary
./model/route : Route
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

  initialize : (TEXTURE_SIZE_P, VIEWPORT_SIZE, DISTANCE_3D, controlMode) =>

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

            supportedDataLayers = [{name: "color", bitDepth: 8, allowManipulation : true},
                                    {name: "volume", bitDepth: 16, allowManipulation : false},
                                    {name: "segmentation", bitDepth: 16, allowManipulation : false}]            

            zoomStepCount = Infinity
            @binary = {}
            for layer in tracing.content.dataSet.dataLayers
              for supportedLayer in supportedDataLayers
                if layer.typ == supportedLayer.name
                  @binary[layer.typ] = new Binary(@user, tracing.content.dataSet, TEXTURE_SIZE_P, supportedLayer)
              zoomStepCount = Math.min(zoomStepCount, @binary[layer.typ].cube.ZOOM_STEP_COUNT - 1)

            @flycam = new Flycam2d(VIEWPORT_SIZE, @scaleInfo, zoomStepCount, @user)      
            @flycam3d = new Flycam3d(DISTANCE_3D, tracing.content.dataSet.scale)
            @flycam3d.on
              "changed" : (matrix) =>
                @flycam.setPosition([matrix[12], matrix[13], matrix[14]])
            @flycam.on
              "positionChanged" : (position) =>
                @flycam3d.setPositionSilent(position)
            @route = new Route(tracing, @scaleInfo, @flycam, @flycam3d, @user)
            @volumeTracing = new VolumeTracing(@flycam, @binary["color"].cube)
            
            {"restrictions": tracing.restrictions, "settings": tracing.content.settings}
            
          -> Toast.error("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
        )