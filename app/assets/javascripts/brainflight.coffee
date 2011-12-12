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
      "/assets/javascripts/obj_loader.js",
      "/assets/javascripts/binary_request.js",
      "/assets/javascripts/core_ext.js",
      "/assets/javascripts/event_emitter.js",
      "/assets/javascripts/controller.js",
      "/assets/javascripts/model.js",
      "/assets/javascripts/demo.js"
    ]
    complete: () -> start()