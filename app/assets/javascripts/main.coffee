$             = require("jquery")
_             = require("lodash")
Backbone      = require("backbone")
ErrorHandling = require("libs/error_handling")
app           = require("./app")
require("bootstrap")
require("fetch")
require("./libs/core_ext")

ErrorHandling.initialize( throwAssertions: false, sendLocalErrors: false )

Router = require("./router")

app.addInitializer( ->
  app.router = new Router()
  Backbone.history.start( pushState : true )
)

$ ->
  # show the bootstrap flash modal on load
  $("#flashModal").modal("show")

  app.start()

