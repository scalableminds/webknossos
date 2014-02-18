require [
  "jquery"
  "underscore"
  "./main/errorHandling"
  "./main/router"
  "bootstrap"
  "./main/enhancements"
  "libs/core_ext"
], ($, _, ErrorHandling, Router) ->

  ErrorHandling.initialize( { throwAssertions: false, sendLocalErrors: false } )
  $ -> new Router()

