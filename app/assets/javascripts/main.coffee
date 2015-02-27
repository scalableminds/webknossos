require [
  "jquery"
  "underscore"
  "backbone"
  "app"
  "main/errorHandling"
  "bootstrap"
  "libs/core_ext"
], ($, _, Backbone, app, ErrorHandling) ->

  ErrorHandling.initialize( throwAssertions: false, sendLocalErrors: false )

  require ["main/router"], (Router) ->

    app.addInitializer( ->

      app.router = new Router()
      Backbone.history.start( pushState : true )
      app.router.historyStart()

    )

    $ ->

      app.start()

