require.config(

  baseUrl : "/assets/javascripts"

  waitSeconds : 0

  paths :
    "jquery"              : "../bower_components/jquery/jquery"
    "underscore"          : "../bower_components/lodash/lodash"
    "bootstrap"           : "../bower_components/bootstrap/dist/js/bootstrap"
    "slider"              : "../bower_components/seiyria-bootstrap-slider/js/bootstrap-slider"
    "coffee-script"       : "../bower_components/coffee-script/extras/coffee-script"
    "backbone.marionette" : "../bower_components/backbone.marionette/lib/backbone.marionette"
    "backbone.paginator"  : "../bower_components/backbone.paginator/dist/backbone.paginator"
    "backbone"            : "../bower_components/backbone/backbone"
    "gzip"                : "../bower_components/zlib/bin/gzip.min"
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
    "c3"                  : "../bower_components/c3/c3"
    "d3"                  : "../bower_components/d3/d3"
    "daterangepicker"     : "../bower_components/bootstrap-daterangepicker/daterangepicker"
    "rangeslider"         : "../bower_components/nouislider/distribute/nouislider.min"
    "clipboard"           : "../bower_components/clipboard.js/clipboard.min"
    "mjs"                 : "../bower_components/mjs/src/mjs"
    "cola"                : "../bower_components/webcola/WebCola/cola.min"
    "fetch"               : "../bower_components/fetch/fetch"
    "promise"             : "../bower_components/es6-promise/promise.min"
    "fileinput"           : "../bower_components/jasny-bootstrap/js/fileinput"
    "worker"              : "libs/worker_plugin"
    "wrapped_worker"      : "libs/wrapped_worker_plugin"
    "nested_obj_model"    : "libs/nested_obj_model"

  shim :
    "underscore" :
      exports : "_"
    "bootstrap" : [ "jquery" ]
    "slider" : [ "bootstrap" ]
    "ace" :
      exports : "ace"
    "routes" :
      exports : "jsRoutes"
    "three" :
      exports : "THREE"
    "gzip" :
      exports : "Zlib"
    "stats" :
      exports : "Stats"
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
    "cola" :
      exports : "cola"

)
