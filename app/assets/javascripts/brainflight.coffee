require.config 
  baseUrl : "/assets/javascripts"
  locale  : "de-de"

require [ "core_ext" ], ->
  require ["controller"], (Controller) ->
    $ ->
      $("#render").resize( ->
        _canvas = $(this)
        this.width = _canvas.width()
        this.height = _canvas.height()
      ).resize()
      Controller.initialize() 
