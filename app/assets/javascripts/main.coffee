require.config

  baseUrl : "/assets/javascripts"

  paths :
    "jquery" : "libs/jquery-1.8.3.min"
    "multiselect" : "libs/bootstrap-multiselect"
    "slider" : "libs/bootstrap-slider"
    "underscore" : "libs/lodash-1.3.1"
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

require [
  "jquery"
  "underscore"
  "bootstrap"
], ->

  require [
    "qassert"
  ], ->

    # Airbrake shim
    unless window.Airbrake?
      window.Airbrake = []
    else
      # TODO: ensure that the filter is also added when Airbrake loaded later
      Airbrake.addFilter( (notice) ->
        return location.hostname != "127.0.0.1" and location.hostname != "localhost"
      )

    window.onerror = (message, file, line) ->

      Airbrake.push({error: {message: message, fileName: file, lineNumber: line}})


    $.assertSetup(
      ajax :
        url : "/assert"
        type : "POST"
        contentType : "application/x-www-form-urlencoded"
      catchGlobalErrors : false
      context :
        userAgent :
          version : navigator.appVersion
          product : navigator.product + " - " + navigator.productSub
          vendor : navigator.vendor + " - " + navigator.vendorSub
          platform : navigator.platform
      log: ->
        console.warn.apply(console, arguments)
        [title, message, linebreak, additionalInfos] = arguments
        stacktrace = additionalInfos.Stacktrace
        Airbrake.push({error : {message: title + " " + message}, params: stacktrace})
    )


    require [
      "./main/enhancements"
      "./main/routing"
      "libs/core_ext"
    ], ->
