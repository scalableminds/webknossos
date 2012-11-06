### define 
model/binary : Binary
model/route : Route
model/user : User
###

# This is the model. It takes care of the data including the 
# communication with the server.

# All public operations are **asynchronous**. We return a promise
# which you can react on.

class Model

  constructor : (options) ->

    @binary = new Binary(options.dataSet.id)
    @route = new Route(options.dataSet, options.experiment, options.experiments)
    @user = new User(options.user)
