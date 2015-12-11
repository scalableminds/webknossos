$             = require("jquery")
_             = require("lodash")
Backbone      = require("backbone")
app           = require("./app")
ErrorHandling = require("./main/error_handling")
require("bootstrap")
require("fetch")
require("./libs/core_ext")

ErrorHandling.initialize( throwAssertions: false, sendLocalErrors: false )

Router = require("./main/router")

app.addInitializer( ->
  app.router = new Router()
  Backbone.history.start( pushState : true )
)

$ ->
  # show the bootstrap flash modal on load
  $("#flashModal").modal("show")

  app.start()

