$             = require("jquery")
_             = require("lodash")
Backbone      = require("backbone")
ErrorHandling = require("libs/error_handling")
Request       = require("libs/request")
app           = require("./app")

require("bootstrap")
require("jasny-bootstrap")
require("whatwg-fetch")
require("es6-promise")
require("libs/core_ext")
require("backbone.marionette")

require("../stylesheets/main.less")

ErrorHandling.initialize( throwAssertions : false, sendLocalErrors : false )

Router = require("./router")

app.on("start", ->
  app.router = new Router()
  Backbone.history.start( pushState : true )
)

app.on("start", ->
  Request.receiveJSON("/api/user", doNotCatch : true)
    .then((user) ->
      app.currentUser = user
      ErrorHandling.setCurrentUser(user)
      return
    ).catch((error) -> return)
)

app.on("start", ->
  # set app.vent to the global radio channel
  app.vent = Backbone.Radio.channel('global')
)


$ ->
  # show the bootstrap flash modal on load
  $("#flashModal").modal("show")

  app.start()

