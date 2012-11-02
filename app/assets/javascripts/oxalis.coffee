require.config 

  baseUrl : "/assets/javascripts"
  locale  : "de-de"
  paths : 
    "three": "libs/threejs/three"
    "stats" : "libs/threejs/stats"
    "v3" : "libs/v3"
    "m4x4" : "libs/m4x4"
    "jquery" : "libs/jquery-1.7.1"
    "underscore" : "libs/underscore-1.2.0.min"
    "dat" : "libs/dat.gui.min"
  shim : 
    "three" : 
      exports : "THREE"
    "stats" : 
      exports : "Stats"
    "v3" : 
      exports : "V3"
    "m4x4" : 
      exports : "M4x4"
    "underscore" :
      exports : "_"

define [
  "jquery" 
  "controller"
  "core_ext"
], ($, Controller) ->

  window.oxalis = new Controller()
  return
