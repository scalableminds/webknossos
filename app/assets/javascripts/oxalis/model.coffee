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
            @binary = new Binary(@user, tracing.content.dataSet, constants.TEXTURE_SIZE_P)
            @flycam = new Flycam2d(constants.PLANE_WIDTH, @scaleInfo, @binary.cube.ZOOM_STEP_COUNT - 1, @user)      
            @flycam3d = new Flycam3d(constants.DISTANCE_3D, tracing.content.dataSet.scale)
            @flycam3d.on
              "changed" : (matrix) =>
                @flycam.setPosition([matrix[12], matrix[13], matrix[14]])
            @flycam.on
              "positionChanged" : (position) =>
                @flycam3d.setPositionSilent(position)
            @cellTracing = new CellTracing(tracing, @scaleInfo, @flycam, @flycam3d, @user)
            @volumeTracing = new VolumeTracing(@flycam, @binary.cube)
            
            [tracing.restrictions, tracing.content.settings]
            
          -> Toast.error("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
        )