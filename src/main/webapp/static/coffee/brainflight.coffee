$ ->
  canvas = document.getElementById("render")
  $(canvas).resize(->
    _canvas = $ canvas
    canvas.width = _canvas.width()
    canvas.height = _canvas.height()
  ).resize()
  
  Modernizr.load 
    load: [
      "js/binary_reader.js",
      "js/obj_loader.js",
      "js/binary_request.js",
      "js/core_ext.js",
      "js/event_emitter.js",
      "js/controller.js",
      "js/model.js",
      "js/demo.js"
    ]
    complete: () -> start()