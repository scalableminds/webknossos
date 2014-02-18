require [
  "jquery"
  "underscore"
  "backbone"
  "./main/errorHandling"
  "./main/router"
  "bootstrap"
  "./main/enhancements"
  "libs/core_ext"
], ($, _, Backbone, ErrorHandling, Router) ->

  ErrorHandling.initialize( throwAssertions: false, sendLocalErrors: false )
  $ ->
    new Router()
    Backbone.history.start( pushState : true )
