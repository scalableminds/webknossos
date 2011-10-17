(function() {
  var pointcloud, ps, render;
  ps = new PointStream();
  ps.setup(document.getElementById('render'), {
    "antialias": true
  });
  pointcloud = ps.load("/BrainFlight/WebGl/Pointstream/clouds/acorn.asc");
  render = function() {
    ps.translate(0, 0, -25);
    ps.clear();
    ps.render(pointcloud);
  };
  ps.pointSize(6);
  ps.onRender = render;
}).call(this);
