require.config

  baseUrl : "/assets/javascripts"

  paths :
    "jquery" : "libs/jquery-1.8.3.min"
    "multiselect" : "libs/bootstrap-multiselect"
    "slider" : "libs/bootstrap-slider"
    "underscore" : "libs/lodash-2.2.1"
    "bootstrap" : "libs/bootstrap.min"
    "worker" : "libs/worker_plugin"
    "three": "libs/threejs/three"
    "three.trackball": "libs/threejs/TrackballControls"
    "three.color": "libs/threejs/ColorConverter"
    "stats" : "libs/threejs/stats"
    "v3" : "libs/v3"
    "m4x4" : "libs/m4x4"
    "dat" : "libs/dat.gui.min"
    "coffee-script" : "libs/coffee-script-1.4.0.min"
    "qassert" : "libs/qassert"
    "backbone" : "libs/backbone"
    "backbone.marionette" : "libs/backbone.marionette"
    "moment" : "libs/moment.min"

  shim :
    "underscore" :
      exports : "_"
    "bootstrap" : [ "jquery" ]
    "multiselect" : [ "bootstrap" ]
    "slider" : [ "bootstrap" ]
    "libs/viz" :
      exports : "Viz"
    "routes" :
      exports : "jsRoutes"
    "libs/ace/ace" :
      exports : "ace"
    "three" :
      exports : "THREE"
    "stats" :
      exports : "Stats"
    "v3" :
      exports : "V3"
    "m4x4" :
      exports : "M4x4"
    "qassert" : [ "jquery" ]
    "backbone" :
      depends : [ "underscore" ]
      exports : "Backbone"
    "backbone.marionette" : [ "backbone", "underscore" ]

require [
  "jquery"
  "underscore"
  "bootstrap"
], ->

  require [
    "qassert"
  ], ->

    $.assertSetup(
      ajax :
        url : "/assert"
        type : "POST"
        contentType : "application/x-www-form-urlencoded"
      catchGlobalErrors : true
      context :
        userAgent :
          version : navigator.appVersion
          product : navigator.product + " - " + navigator.productSub
          vendor : navigator.vendor + " - " + navigator.vendorSub
          platform : navigator.platform
      log: $.proxy(console.warn, console)
    )

    require [
      "./main/router"
      "./main/enhancements"
      "libs/core_ext"
    ], (Router) ->

      $ ->

        new Router()
        Backbone.history.start({pushState : true})

