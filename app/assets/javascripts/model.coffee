### define 
model/binary : Binary
model/route : Route
model/user : User
underscore : _
###

# This is the model. It takes care of the data including the 
# communication with the server.

# All public operations are **asynchronous**. We return a promise
# which you can react on.

class Model

  constructor : (options) ->

    @binary = Binary(options.dataSet.id)
    #@route = new Route()
    #@user = new User()
