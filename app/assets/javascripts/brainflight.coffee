MVC = null

require.config 
  baseUrl : "/assets/javascripts"
  locale  : "de-de"

require [ "core_ext" ], ->
  require ["controller", "view", "model"], (Controller, View, Model) ->
    
    MVC = { Controller, View, Model }
    $ ->
      _canvas = $("#render")
      canvas  = _canvas[0]

      Controller.initialize(canvas) 
      View.initialize(canvas)