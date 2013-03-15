require.config

  baseUrl : "/assets/javascripts"

  paths :
    "jquery" : "libs/jquery-1.8.3.min"
    "underscore" : "libs/lodash-1.0.0-rc.2.min"
    "bootstrap" : "libs/bootstrap.min"
    "worker" : "libs/worker_plugin"
    "three": "libs/threejs/three"
    "stats" : "libs/threejs/stats"
    "v3" : "libs/v3"
    "m4x4" : "libs/m4x4"
    "dat" : "libs/dat.gui.min"
    "coffee-script" : "libs/coffee-script-1.4.0.min"
    "qassert" : "libs/qassert"
    "svgpan" : "http://talos.github.com/jquery-svgpan/jquery-svgpan"

  shim :
    "underscore" :
      exports : "_"
    "bootstrap" : [ "jquery" ]
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
    "./main/enhancements"
    "./main/routing"
    "libs/core_ext"
    "qassert"
  ], ->

    $.assertSetup(
      ajax :
        url : "/assert"
        type : "POST"
        contentType : "application/x-www-form-urlencoded"
      catchGlobalErrors : true
      context : "Oxalis"
      log: $.proxy(console.warn, console)
    )
