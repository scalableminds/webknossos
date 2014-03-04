require [
  "jquery"
  "underscore"
  "backbone"
  "app"
  "main/errorHandling"
  "main/router"
  "main/non_backbone_router"
  "bootstrap"
  "main/enhancements"
  "libs/core_ext"
], ($, _, Backbone, app, ErrorHandling, Router, NonBackboneRouter) ->

  ErrorHandling.initialize( throwAssertions: false, sendLocalErrors: false )

  app.addInitializer( ->

    new NonBackboneRouter() #handle all the routes that are not yet Backbone Views
    app.router = new Router()
    Backbone.history.start( pushState : true )
  )

  $ ->

    app.start()

