require.config(

  baseUrl : "/assets/javascripts"

  waitSeconds : 0

  paths :
    "jquery"              : "../bower_components/jquery/jquery"
    "underscore"          : "../bower_components/lodash/dist/lodash"
    "bootstrap"           : "../bower_components/bootstrap/docs/assets/js/bootstrap"
    "slider"              : "../bower_components/seiyria-bootstrap-slider/js/bootstrap-slider"
    "coffee-script"       : "../bower_components/coffee-script/extras/coffee-script"
    "backbone.marionette" : "../bower_components/backbone.marionette/lib/backbone.marionette"
    "backbone.paginator"  : "../bower_components/backbone.paginator/dist/backbone.paginator"
    "backbone"            : "../bower_components/backbone/backbone"
    "three"               : "../bower_components/three/index"
    "three.color"         : "../bower_components/ColorConverter/index"
    "three.trackball"     : "../bower_components/TrackballControls/index"
    "stats"               : "../bower_components/threejs-stats/Stats"
    "dat"                 : "../bower_components/dat.gui/dat.gui"
    "ace"                 : "../bower_components/ace-builds/src-min-noconflict/ace"
    "keyboard"            : "../bower_components/KeyboardJS/keyboard"
    "gamepad"             : "../bower_components/gamepad.js/gamepad"
    "jquery.mousewheel"   : "../bower_components/jquery-mousewheel/jquery.mousewheel"
    "jquery.bootpag"      : "../bower_components/jquery-bootpag/lib/jquery.bootpag"
    "tween"               : "../bower_components/tweenjs/build/Tween"
    "dat.gui"             : "../bower_components/dat.gui/dat.gui"
    "moment"              : "../bower_components/momentjs/moment"
    "require"             : "../bower_components/requirejs/require"
    "v3"                  : "libs/v3"
    "m4x4"                : "libs/m4x4"
    "worker"              : "libs/worker_plugin"

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
    "backbone" :
      deps : [ "jquery", "underscore" ]
      exports : "Backbone"
    "backbone.marionette" : [ "backbone", "underscore" ]
    "backbone.paginator" : [ "backbone", "underscore" ]

)