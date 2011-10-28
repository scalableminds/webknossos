$ ->
  canvas = document.getElementById("render")
  $(canvas).resize(->
    _canvas = $ canvas
    canvas.width = _canvas.width()
    canvas.height = _canvas.height()
  ).resize()
  
  Modernizr.load 
    # load: ['js/model.js']
    load: ['js/binary_reader.js', 'js/demo.js', 'js/model.js']
    complete: () -> start()