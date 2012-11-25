require.config 

  paths : 
    "three": "libs/threejs/three"
    "stats" : "libs/threejs/stats"
    "v3" : "libs/v3"
    "m4x4" : "libs/m4x4"
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
    

require [
  "jquery"
  "controller"
  "core_ext"
  "three"
  "stats"
], ($, Controller) ->

  window.oxalis = new Controller()
  return
