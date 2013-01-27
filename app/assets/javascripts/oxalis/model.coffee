### define 
./model/binary : Binary
./model/route : Route
./model/user : User
./model/scaleinfo : ScaleInfoClass
./model/flycam2d : Flycam2d
./model/flycam3d : Flycam3d
../libs/request : Request
../libs/toast : Toast
###

# This is the model. It takes care of the data including the 
# communication with the server.

# All public operations are **asynchronous**. We return a promise
# which you can react on.

class Model

  initialize : (TEXTURE_SIZE_P, VIEWPORT_SIZE, DISTANCE_3D) =>

	  Request.send(
      url : "/game/initialize"
      dataType : "json"
    ).pipe (task) =>

      Request.send(
        url : "/tracing/#{task.task.id}"
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

              @scaleInfo = new ScaleInfo(tracing.tracing.scale)
              @binary = new Binary(@flycam, tracing.dataSet, TEXTURE_SIZE_P)    
              @flycam = new Flycam2d(VIEWPORT_SIZE, @scaleInfo, @binary.cube.ZOOM_STEP_COUNT - 1)      
              @flycam3d = new Flycam3d(DISTANCE_3D)
              @flycam3d.on
                "changed" : (matrix) =>
                  @flycam.setPosition([matrix[12], matrix[13], matrix[14]])
              @flycam.on
                "positionChanged" : (position) =>
                  @flycam3d.setPositionSilent(position)
              @route = new Route(tracing.tracing, @scaleInfo, @flycam)
              @user = new User(user)

            -> Toast.error("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
          )
