$(function() {
  var canvas;
  canvas = document.getElementById("render");
  $(canvas).resize(function() {
    var _canvas;
    _canvas = $(canvas);
    canvas.width = _canvas.width();
    return canvas.height = _canvas.height();
  }).resize();
  return Modernizr.load({
    load: ['js/binary_reader.js', 'js/demo.js', 'js/model.js'],
    complete: function() {
      return start();
    }
  });
});