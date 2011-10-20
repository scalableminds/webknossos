var pointcloud, ps, render;
ps = new PointStream();
ps.setup(document.getElementById('render'), {
  "antialias": true
});
pointcloud = read_binary_file();
render = function() {
  ps.translate(0, 0, -25);
  ps.clear();
  ps.render(pointcloud);
};
ps.pointSize(10);
ps.onRender = render;