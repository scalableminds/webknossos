require.config(

  baseUrl : "javascripts"
  waitSeconds : 15

  paths :
    underscore : "lodash-0.9.0.min"
    backbone : "backbone-0.9.2.min"
    jquery : "jquery-1.8.2.min"
    jade : "lib/javascripts"
    jadeEngine : "jade-0.26.2"
    templates : "../templates"
    kinetic : "kinetic-4.0.3"
    "require.json" : "require.json"
    "require.text" : "require.text"

  map : 
    "require.json" :
      text : "require.text"

  shim :
    underscore :
      exports : "_"
    backbone :
      deps : [ "underscore" ]
      exports : "Backbone"
    jadeEngine :
      exports : "jade"
    kinetic : 
      exports : "Kinetic"
)

require [
  "jquery"
  "underscore"
  "backbone"
], ($, _, Backbone) ->

  $.ajaxSetup( timeout : 12000 )
  $.support.cors = true

  $ ->

    require [ "flow_controller", "../shellgameAssets/js/playlist" ], (FlowController, playlist) ->

      $("body").removeClass("hidden")

      window.shellgame = new FlowController($("#wrapper")[0], playlist)








