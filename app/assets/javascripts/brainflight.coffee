require.config 
  baseUrl : "/assets/javascripts"
  locale  : "de-de"

require ["controller"], (Controller) ->
  $ ->
      $("#render").resize( ->
        _canvas = $(this)
        this.width = _canvas.width()
        this.height = _canvas.height()
      ).resize()
      Controller.initialize() 
# $ ->
#   canvas = document.getElementById("render")
#   $(canvas).resize(->
#     _canvas = $ canvas
#     canvas.width = _canvas.width()
#     canvas.height = _canvas.height()
#   ).resize()

#   Modernizr.load 
#     load: [
#       "/assets/javascripts/libs/mjs.js"
#       "/assets/javascripts/libs/request.js",
#       "/assets/javascripts/core_ext.js",
#       "/assets/javascripts/libs/simple_worker.js",
#       "/assets/javascripts/libs/simple_array_buffer_socket.js",
#       "/assets/javascripts/model/binary/interpolation_collector.js",
#       "/assets/javascripts/libs/gl_engine/geometry.js",
#       "/assets/javascripts/libs/gl_engine/geometry_trianglesplane.js",
#       "/assets/javascripts/libs/gl_engine/geometry_mesh.js",
#       "/assets/javascripts/libs/gl_engine/flycam.js",
#       "/assets/javascripts/libs/gl_engine/gl_engine.js",
#       "/assets/javascripts/controller.js",
#       "/assets/javascripts/keyboard.js",
#       "/assets/javascripts/view.js",
#       "/assets/javascripts/model.js"
#       "/assets/javascripts/geometry_factory.js"
#     ]
#     complete: () -> start()
