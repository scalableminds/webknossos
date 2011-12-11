
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
    load: ["js/binary_reader.js", "js/obj_loader.js", "js/binary_request.js", "js/core_ext.js", "js/event_emitter.js", "js/controller.js", "js/model.js", "js/demo.js"],
    complete: function() {
      return start();
    }
  });
});
