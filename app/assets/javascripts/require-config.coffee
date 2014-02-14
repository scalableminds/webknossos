if require?
  requirejs = require
else
  requirejs = (config) -> this.require = config

requirejs(
  
  baseUrl : "/assets/javascripts"

  paths :
    "jquery"              : "../bower_components/jquery/jquery.min"
    "underscore"          : "../bower_components/lodash/dist/lodash.min"
    "bootstrap"           : "../bower_components/bootstrap/docs/assets/js/bootstrap.min"
    "slider"              : "../bower_components/bootstrap-slider/bootstrap-slider"
    "coffee-script"       : "../bower_components/coffee-script/extras/coffee-script"
    "backbone.marionette" : "../bower_components/backbone.marionette/lib/backbone.marionette.min"
    "backbone"            : "../bower_components/backbone/backbone-min"
    "three"               : "../bower_components/three.js/build/three"
    "three.color"         : "../bower_components/three.js/examples/js/math/ColorConverter"
    "three.trackball"     : "../bower_components/three.js/examples/js/controls/TrackballControls"
    "stats"               : "../bower_components/threejs-stats/Stats"
    "dat"                 : "../bower_components/dat.gui/dat.gui.min"
    "ace"                 : "../bower_components/ace-builds/src-min-noconflict/ace"
    "keyboard"            : "../bower_components/KeyboardJS/keyboard"
    "gamepad"             : "../bower_components/gamepad.js/gamepad"
    "jquery.mousewheel"   : "../bower_components/jquery-mousewheel/jquery.mousewheel"
    "jquery.bootpag"      : "../bower_components/jquery-bootpag/lib/jquery.bootpag"
    "tween"               : "../bower_components/tweenjs/build/Tween"
    "dat.gui"             : "../bower_components/dat.gui/dat.gui.min"
    "v3"                  : "libs/v3"
    "m4x4"                : "libs/m4x4"
    "worker"              : "libs/worker_plugin"
    "qassert"             : "libs/qassert"

  shim :
    "underscore" :
      exports : "_"
    "bootstrap" : [ "jquery" ]
    "slider" : [ "bootstrap" ]
    "ace" :
      exports : "ace"
    "libs/viz" :
      exports : "Viz"
    "routes" :
      exports : "jsRoutes"
    "three" :
      exports : "THREE"
    "stats" :
      exports : "Stats"
    "v3" :
      exports : "V3"
    "m4x4" :
      exports : "M4x4"
    "three.trackball" :
      deps : ["three"]
    "three.color" :
      deps : ["three"]
      exports : "THREE.ColorConverter"
    "qassert" : [ "jquery"]
    "backbone" : [ "underscore" ]
    "backbone.marionette" : [ "backbone", "underscore" ]
)