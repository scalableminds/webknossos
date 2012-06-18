MVC = null

require.config 
  baseUrl : "/assets/javascripts"
  locale  : "de-de"

require [ "core_ext" ], ->
  require ["controller", "view", "model"], (Controller, View, Model) ->
    
    MVC = { Controller, View, Model }
    $ ->
      _canvases = $("#render")
      canvases  = _canvases[0]

      Controller.initialize(canvases) 
      View.initialize()