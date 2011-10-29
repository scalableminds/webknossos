var cam, keyDown, mesh, mouseDown, mousePressed, mouseReleased, pointcloud, ps, render, start;
ps = void 0;
pointcloud = void 0;
mesh = void 0;
cam = void 0;
mouseDown = false;
mousePressed = function() {
  return mouseDown = true;
};
mouseReleased = function() {
  return mouseDown = false;
};
keyDown = function() {
  switch (ps.key) {
    case 119:
      cam.pos = V3.add(cam.pos, V3.scale(cam.dir, 0.2));
      break;
    case 115:
      cam.pos = V3.add(cam.pos, V3.scale(cam.dir, -0.2));
      break;
    case 97:
      cam.pos = V3.add(cam.pos, V3.scale(cam.left, 0.2));
      break;
    case 100:
      cam.pos = V3.add(cam.pos, V3.scale(cam.left, -0.2));
  }
};
render = function() {
  var h, status, y;
  if (mouseDown) {
    y = -(ps.mouseX - ps.width / 2) / ps.width / 45;
    cam.yaw(y);
    h = -(ps.mouseY - ps.height / 2) / ps.height / 8;
    cam.pos = V3.add(cam.pos, [0, h, 0]);
  }
  ps.loadMatrix(M4x4.makeLookAt(cam.pos, V3.add(cam.dir, cam.pos), cam.up));
  ps.clear();
  ps.renderMesh(mesh);
  status = document.getElementById('Status');
  status.innerHTML = Math.floor(ps.frameRate) + " FPS <br/> " + pointcloud.numPoints + " Points";
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
  ps.onKeyDown = keyDown;
  pointcloud = read_binary_file();
  mesh = read_obj_file();
};