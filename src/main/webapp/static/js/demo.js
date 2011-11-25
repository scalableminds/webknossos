var cam, changePerspectiveParams, clipping_distance, eng, mesh, mouseDown, pointcloud, render, setCamPosition, start;
eng = void 0;
pointcloud = void 0;
mesh = void 0;
cam = void 0;
mouseDown = false;
clipping_distance = 15.0;
render = function() {
  var d, h, length_dir, n0, p, status, versch, y;
  if (mouseDown) {
    y = -(eng.mouseX - eng.width / 2) / eng.width / 45;
    cam.yaw(y);
    h = -(eng.mouseY - eng.height / 2) / eng.height / 8;
    cam.pos = V3.add(cam.pos, [0, h, 0]);
  }
  eng.loadMatrix(M4x4.makeLookAt(cam.pos, V3.add(cam.dir, cam.pos), cam.up));
  length_dir = Math.sqrt(cam.dir[0] * cam.dir[0] + cam.dir[1] * cam.dir[1] + cam.dir[2] * cam.dir[2]);
  n0 = [cam.dir[0] / length_dir, cam.dir[1] / length_dir, cam.dir[2] / length_dir];
  versch = [clipping_distance * n0[0], clipping_distance * n0[1], clipping_distance * n0[2]];
  p = V3.add(cam.pos, versch);
  d = V3.dot(p, n0);
  eng.uniformf("d", d);
  eng.uniformf("n0", n0);
  eng.clear();
  eng.translate(p[0], p[1], p[2]);
  status = document.getElementById('status');
  status.innerHTML = "" + (Math.floor(eng.frameRate)) + " Feng <br/> " + pointcloud.vertices.length + " Points <br />" + cam.pos;
};
start = function() {
  cam = new FreeCam();
  cam.pos = [6, 5, -15];
  eng = new GL_engine(document.getElementById('render'), {
    "antialias": true
  });
  /*
  	vert = eng.getShaderStr("js/libs/pointstream/shaders/clip.vs")
  	frag = eng.getShaderStr("js/libs/pointstream/shaders/clip.fs")
  	progObj = eng.createProgram(vert, frag);
  	eng.useProgram(progObj);
  	*/
  eng.perspective(60, eng.width / eng.height, 15, 20);
  eng.background([0.9, 0.9, 0.9, 1]);
  eng.pointSize(5);
  pointcloud = read_binary_file();
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
changePerspectiveParams = function() {
  var far, fovy, near;
  near = parseFloat(document.getElementById('near').value);
  far = parseFloat(document.getElementById('far').value);
  fovy = parseFloat(document.getElementById('fovy').value);
  if (!isNaN(near) && !isNaN(far) && !isNaN(fovy)) {
    eng.perspective(fovy, eng.width / eng.height, near, far);
  }
};