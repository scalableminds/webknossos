var cam, changeClippingParams, clipping_distance, keyDown, mesh, mouseDown, mousePressed, mouseReleased, pointcloud, ps, render, setCamPosition, start;
ps = void 0;
pointcloud = void 0;
mesh = void 0;
cam = void 0;
mouseDown = false;
clipping_distance = 15.0;
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
  var cameraPos, d, h, length_dir, n0, p, versch, y;
  if (mouseDown) {
    y = -(ps.mouseX - ps.width / 2) / ps.width / 45;
    cam.yaw(y);
    h = -(ps.mouseY - ps.height / 2) / ps.height / 8;
    cam.pos = V3.add(cam.pos, [0, h, 0]);
  }
  ps.loadMatrix(M4x4.makeLookAt(cam.pos, V3.add(cam.dir, cam.pos), cam.up));
  length_dir = Math.sqrt(cam.dir[0] * cam.dir[0] + cam.dir[1] * cam.dir[1] + cam.dir[2] * cam.dir[2]);
  n0 = [cam.dir[0] / length_dir, cam.dir[1] / length_dir, cam.dir[2] / length_dir];
  versch = [clipping_distance * n0[0], clipping_distance * n0[1], clipping_distance * n0[2]];
  p = V3.add(cam.pos, versch);
  d = V3.dot(p, n0);
  ps.uniformf("d", d);
  ps.uniformf("n0", n0);
  ps.clear();
  ps.render(pointcloud);
  ps.translate(p[0], p[1], p[2]);
  ps.renderMesh(mesh);
  cameraPos = document.getElementById('camera');
  cameraPos.innerHTML = cam.pos;
};
start = function() {
  var frag, progObj, vert;
  cam = new FreeCam();
  ps = new PointStream();
  ps.setup(document.getElementById('render'), {
    "antialias": true
  });
  vert = ps.getShaderStr("js/libs/pointstream/shaders/clip.vs");
  frag = ps.getShaderStr("js/libs/pointstream/shaders/clip.fs");
  progObj = ps.createProgram(vert, frag);
  ps.useProgram(progObj);
  ps.background([0.9, 0.9, 0.9, 1]);
  ps.pointSize(5);
  ps.onRender = render;
  ps.onMousePressed = mousePressed;
  ps.onMouseReleased = mouseReleased;
  ps.onKeyDown = keyDown;
  pointcloud = read_binary_file();
  mesh = read_obj_file();
};
setCamPosition = function() {
  var x, y, z;
  x = parseFloat(document.getElementById('camX').value);
  y = parseFloat(document.getElementById('camY').value);
  z = parseFloat(document.getElementById('camZ').value);
  if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
    cam.pos = [x, y, z];
  }
};
changeClippingParams = function() {
  var d, distance, n0;
  distance = parseFloat(document.getElementById('clipDistance').value);
  if (!isNaN(distance)) {
    clipping_distance = distance;
  }
  n0 = document.getElementById('clipN0').value.split(",");
  n0[0] = parseFloat(n0[0]);
  n0[1] = parseFloat(n0[1]);
  n0[2] = parseFloat(n0[2]);
  if (!isNaN(n0[0]) && !isNaN(n0[1]) && !isNaN(n0[2])) {
    ps.uniformf("n0", n0);
  }
  return;
  d = parseFloat(document.getElementById('clipD').value);
  if (!isNaN(d)) {
    ps.uniformf("d", d);
  }
};