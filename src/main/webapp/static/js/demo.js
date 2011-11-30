var cam, changePerspectiveParams, clipping_distance, eng, fragmentShader, loadPointcloud, mesh, mouseDown, pointcloud, render, setCamPosition, start, vertexShader;
eng = void 0;
pointcloud = void 0;
mesh = void 0;
cam = void 0;
mouseDown = false;
clipping_distance = 15.0;
fragmentShader = "#ifdef GL_ES\n  precision highp float;\n#endif\nvarying vec4 frontColor;void main(void){  gl_FragColor = frontColor;}";
vertexShader = "varying vec4 frontColor;attribute vec3 aVertex;attribute vec4 aColor;uniform float pointSize;uniform vec3 attenuation;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;uniform mat4 normalMatrix;uniform float d;uniform vec3 n0;void main(void){  frontColor =  aColor;  vec4 ecPos4 = modelViewMatrix * vec4(aVertex, 1.0);  float dist = length( ecPos4 );  float attn = attenuation[0] +               (attenuation[1] * dist) +              (attenuation[2] * dist * dist);  gl_PointSize = pointSize * sqrt(1.0/attn);    float s = dot(aVertex, n0);  s = s - d;     if( s < 0.0){    gl_Position = vec4(0.0, 0.0, 0.0, 0.0);    frontColor = vec4(0.0, 0.0, 0.0, 1.0);    gl_PointSize = 0.0;  }else{	gl_Position = projectionMatrix * ecPos4;  }}";
render = function() {
  var d, h, length_dir, n0, p, status, versch, y;
  if (mouseDown) {
    y = -(eng.mouseX - eng.getWidth / 2) / eng.getWidth / 45;
    cam.yaw(y);
    h = -(eng.mouseY - eng.getHeight / 2) / eng.getHeight / 8;
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
  eng.render(pointcloud);
  eng.translate(p[0], p[1], p[2]);
  status = document.getElementById('status');
  status.innerHTML = "" + (Math.floor(eng.getFramerate())) + " Feng <br/> " + pointcloud.vertices.length + " Points <br />" + cam.pos;
};
start = function() {
  var progObj;
  cam = new FreeCam();
  cam.pos = [6, 5, -15];
  eng = new GL_engine(document.getElementById('render'), {
    "antialias": true
  });
  progObj = eng.createShaderProgram(vertexShader, fragmentShader);
  eng.useProgram(progObj);
  eng.onRender(render);
  eng.perspective(60, eng.getWidth / eng.getHeight, 15, 20);
  eng.background([0.9, 0.9, 0.9, 1]);
  eng.pointSize(5);
  return pointcloud = loadPointcloud();
};
loadPointcloud = function() {
  var xhr;
  xhr = new XMLHttpRequest();
  xhr.open("GET", "image/z0000/100527_k0563_mag1_x0017_y0017_z0000.raw", true);
  xhr.responseType = "arraybuffer";
  this.pointCloud = new Pointcloud;
  xhr.onload = function(e) {
    var RGB_colors, currentColor, currentPixel, dimensions, grey_scale_colors, numVerts, vertices, x, y, z;
    grey_scale_colors = new Uint8Array(this.response);
    dimensions = 128;
    numVerts = grey_scale_colors.length;
    vertices = new Float32Array(numVerts * 3);
    RGB_colors = new Float32Array(numVerts * 3);
    currentPixel = 0;
    currentColor = 0;
    for (y = 0; 0 <= 12.7 ? y <= 12.7 : y >= 12.7; y += 0.1) {
      for (x = 0; 0 <= 12.7 ? x <= 12.7 : x >= 12.7; x += 0.1) {
        for (z = 0; 0 <= 12.7 ? z <= 12.7 : z >= 12.7; z += 0.1) {
          vertices[currentPixel] = x;
          vertices[currentPixel + 1] = y;
          vertices[currentPixel + 2] = z;
          RGB_colors[currentPixel] = grey_scale_colors[currentColor] / 255;
          RGB_colors[currentPixel + 1] = grey_scale_colors[currentColor] / 255;
          RGB_colors[currentPixel + 2] = grey_scale_colors[currentColor] / 255;
          currentPixel += 3;
          currentColor++;
        }
      }
    }
    pointCloud.setVertices(eng.createArrayBufferObject(vertices), vertices.length);
    pointCloud.setColors(eng.createArrayBufferObject(RGB_colors), RGB_colors.length);
    pointCloud.fragmentShader = fragmentShader;
    return pointCloud.vertexShader = vertexShader;
  };
  xhr.send(null);
  return pointCloud;
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
    eng.perspective(fovy, eng.getWidth / eng.getHeight, near, far);
  }
};