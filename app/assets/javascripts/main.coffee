require [
  "jquery"
  "underscore"
  "backbone"
  "app"
  "main/errorHandling"
  "main/router"
  "bootstrap"
  "main/enhancements"
  "libs/core_ext"
], ($, _, Backbone, app, ErrorHandling, Router) ->

  ErrorHandling.initialize( throwAssertions: false, sendLocalErrors: false )


  app.addInitializer( ->

    app.router = new Router()
    Backbone.history.start( pushState : true )
  )

  $ ->

    app.start()

