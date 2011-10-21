var cam, mouseDown, mousePressed, mouseReleased, pointcloud, ps, render, start;
ps = void 0;
pointcloud = void 0;
cam = void 0;
mouseDown = false;
mousePressed = function() {
  return mouseDown = true;
};
mouseReleased = function() {
  return mouseDown = false;
};
render = function() {
  var h, status, y;
  y = -(ps.mouseX - ps.width / 2) / ps.width / 50;
  cam.yaw(y);
  if (mouseDown) {
    cam.pos = V3.add(cam.pos, V3.scale(cam.dir, 0.1));
  }
  h = -(ps.mouseY - ps.height / 2) / ps.height / 10;
  cam.pos = V3.add(cam.pos, [0, h, 0]);
  ps.loadMatrix(M4x4.makeLookAt(cam.pos, V3.add(cam.dir, cam.pos), cam.up));
  ps.println(cam.pos);
  ps.clear();
  ps.render(pointcloud);
  status = document.getElementById('Status');
  status.innerHTML = Math.floor(ps.frameRate) + " FPS";
};
start = function() {
  cam = new FreeCam();
  ps = new PointStream();
  ps.setup(document.getElementById('render'), {
    "antialias": true
  });
  ps.background([0.9, 0.9, 0.9, 1]);
  ps.pointSize(5);
  ps.onRender = render;
  ps.onMousePressed = mousePressed;
  ps.onMouseReleased = mouseReleased;
  pointcloud = read_binary_file();
};