$(function() {
  var canvas;
  canvas = document.getElementById("render");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  return Modernizr.load({
    load: ['js/binary_reader.js', 'js/demo.js'],
    complete: function() {
      return start();
    }
  });
});