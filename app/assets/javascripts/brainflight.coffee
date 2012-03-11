_MVC = null

require.config 
  baseUrl : "/assets/javascripts"
  locale  : "de-de"

require [ "core_ext" ], ->
  require ["controller", "view", "model"], (Controller, View, Model) ->
    
    _MVC = { Controller, View, Model }
    $ ->
      
      _canvas = $("#render")
      canvas  = _canvas[0]

      _canvas.resize( ->
        this.width = _canvas.width()
        this.height = _canvas.height()
      ).resize()

      Controller.initialize(canvas) 
      View.initialize(canvas)