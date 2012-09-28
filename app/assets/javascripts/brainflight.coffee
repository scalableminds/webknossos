MVC = null

require.config 
  baseUrl : "/assets/javascripts"
  locale  : "de-de"

require [ "core_ext" ], ->
  require ["controller", "view", "model"], (Controller, View, Model) ->
    
    controller = new Controller()
    MVC = { controller, View, Model }