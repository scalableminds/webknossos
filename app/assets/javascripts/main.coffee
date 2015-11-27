require [
  "jquery"
  "underscore"
  "backbone"
  "app"
  "main/errorHandling"
  "bootstrap"
  "fetch"
  "libs/core_ext"
], ($, _, Backbone, app, ErrorHandling) ->

  ErrorHandling.initialize( throwAssertions: false, sendLocalErrors: false )

  require ["main/router", "main/non_backbone_router"], (Router, NonBackboneRouter) ->

    app.addInitializer( ->

      new NonBackboneRouter() # handle all the routes that are not yet Backbone Views
      app.router = new Router()
      Backbone.history.start( pushState : true )
    )

    $ ->
      # show the bootstrap flash modal on load
      $("#flashModal").modal("show")

      app.start()
