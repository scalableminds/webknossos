$ ->
  canvas = document.getElementById("render")
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  
  Modernizr.load 
    load: ['js/binary_reader.js', 'js/demo.js']
    complete: () -> start()