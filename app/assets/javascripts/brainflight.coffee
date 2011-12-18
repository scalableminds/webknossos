$ ->
  canvas = document.getElementById("render")
  $(canvas).resize(->
    _canvas = $ canvas
    canvas.width = _canvas.width()
    canvas.height = _canvas.height()
  ).resize()
  
  Modernizr.load 
    load: [
      "/assets/javascripts/binary_reader.js",
      "/assets/javascripts/obj_reader.js",
      "/assets/javascripts/binary_request.js",
      "/assets/javascripts/core_ext.js",
      "/assets/javascripts/event_emitter.js",
      "/assets/javascripts/libs/csg.js",
      "/assets/javascripts/libs/GL_engine/GL_engine.js",
      "/assets/javascripts/libs/GL_engine/geometry.js",
      "/assets/javascripts/libs/GL_engine/geometry_pointcloud.js",
      "/assets/javascripts/libs/GL_engine/geometry_mesh.js",
      "/assets/javascripts/libs/c3.js",
      "/assets/javascripts/libs/mjs.js"
      "/assets/javascripts/controller.js",
      "/assets/javascripts/view.js",
      "/assets/javascripts/model.js",
    ]
    complete: () -> start()
