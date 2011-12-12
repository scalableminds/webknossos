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
    load: ["js/binary_reader.js", "js/obj_reader.js", "js/binary_request.js", "js/core_ext.js", "js/event_emitter.js", "js/libs/GL_engine/geometry.js", "js/libs/GL_engine/geometry_pointcloud.js", "js/libs/GL_engine/geometry_mesh.js", "js/libs/GL_engine/libs/c3.js", "js/libs/GL_engine/libs/mjs.js", "js/controller.js", "js/view.js", "js/model.js"],
    complete: function() {
      return start();
    }
  });
});