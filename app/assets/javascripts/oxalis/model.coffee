### define 
./model/binary : Binary
./model/route : Route
./model/user : User
./model/scaleinfo : ScaleInfoClass
./model/flycam : Flycam
../libs/request : Request
###

# This is the model. It takes care of the data including the 
# communication with the server.

# All public operations are **asynchronous**. We return a promise
# which you can react on.

class Model

  initialize : (TEXTURE_SIZE_P, VIEWPORT_SIZE) =>

	  Request.send(
      url : "/game/initialize"
      dataType : "json"
    ).pipe (task) =>

      Request.send(
        url : "/tracing/#{task.task.id}"
        dataType : "json"
      ).pipe (tracing) =>

        Request.send(
          url : "/user/configuration"
          dataType : "json"
        ).pipe((user) =>

          console.log tracing
          @binary = new Binary(tracing.dataSet, TEXTURE_SIZE_P)
          @scaleInfo = new ScaleInfo(tracing.tracing.scale)
          @route = new Route(tracing.tracing, tracing.dataSet, @scaleInfo)
          @user = new User(user)
          #@flycam = new Flycam(TEXTURE_SIZE_P, VIEWPORT_SIZE)

        -> alert("Ooops. We couldn't communicate with our mother ship. Please try to reload this page."))
