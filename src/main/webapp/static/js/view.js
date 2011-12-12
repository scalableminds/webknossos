var View, _View;
_View = (function() {
  var attach, buttonDown, cam, camPos, clipping_distance, curCoords, cvs, engine, geometries, meshProgramObject, mouseMoved, mousePressed, mouseReleased, mouseX, mouseY, pointcloudProgramObject, renderFunction, rot;
  engine = void 0;
  cam = void 0;
  cvs = void 0;
  geometries = [];
  meshProgramObject = null;
  pointcloudProgramObject = null;
  buttonDown = false;
  mouseX = 0;
  mouseY = 0;
  rot = [0, 0];
  curCoords = [0, 0];
  clipping_distance = 2.0;
  camPos = [5, 6, -15];
  function _View() {
    cvs = document.getElementById('render');
    engine = new GL_engine(cvs, {
      "antialias": true
    });
    cam = new FreeCam();
    cam.pos = camPos;
    engine.background([0.9, 0.9, 0.9, 1]);
    engine.pointSize(5);
    engine.onRender(renderFunction);
    attach(cvs, "mousemove", mouseMoved);
    attach(cvs, "mouseup", mouseReleased);
    attach(cvs, "mousedown", mousePressed);
  }
  renderFunction = function() {
    /*
    		#engine.perspective 60, engine.getWidth() / engine.getHeight(), 15, 30
    		# MOUSE/CAMERA MOVEMENT
    		if buttonDown 
    			y = -(engine.mouseX - engine.getWidth / 2) / engine.getWidth / 45
    			cam.yaw y
    	
    			h = -(engine.mouseY - engine.getHeight / 2) / engine.getHeight / 8
    			cam.pos = V3.add cam.pos, [0, h, 0]
    		
    		*/
    var d, deltaX, deltaY, i, length_dir, n0, p, status, versch, _ref;
    engine.loadMatrix(M4x4.makeLookAt(cam.pos, V3.add(cam.dir, cam.pos), cam.up));
    length_dir = Math.sqrt(cam.dir[0] * cam.dir[0] + cam.dir[1] * cam.dir[1] + cam.dir[2] * cam.dir[2]);
    n0 = [cam.dir[0] / length_dir, cam.dir[1] / length_dir, cam.dir[2] / length_dir];
    versch = [clipping_distance * n0[0], clipping_distance * n0[1], clipping_distance * n0[2]];
    p = V3.add(cam.pos, versch);
    d = V3.dot(p, n0);
    engine.uniformf("d", d);
    engine.uniformf("n0", n0);
    if (buttonDown) {
      deltaX = mouseX - curCoords[0];
      deltaY = mouseY - curCoords[1];
      rot[0] += deltaX / cvs.width * 5;
      rot[1] += deltaY / cvs.height * 5;
      curCoords[0] = mouseX;
      curCoords[1] = mouseY;
    }
    engine.rotateY(rot[1]);
    engine.rotateX(rot[0]);
    engine.clear();
    for (i = 0, _ref = geometries.length; i < _ref; i += 1) {
      if (geometries[i].getClassType() === "Mesh") {
        engine.useProgram = meshProgramObject;
      }
      if (geometries[i].getClassType() === "Pointcloud") {
        engine.useProgram = pointcloudProgramObject;
      }
      engine.render(geometries[i]);
    }
    status = document.getElementById('status');
    status.innerHTML = "" + (Math.floor(engine.getFramerate()));
  };
  _View.prototype.addGeometry = function(geometry) {
    geometries.push(geometry);
    if (geometry.getClassType() === "Mesh") {
      if (meshProgramObject == null) {
        meshProgramObject = engine.createShaderProgram(geometry.vertexShader, geometry.fragmentShader);
      }
    }
    if (geometry.getClassType() === "Pointcloud") {
      return pointcloudProgramObject != null ? pointcloudProgramObject : pointcloudProgramObject = engine.createShaderProgram(geometry.vertexShader, geometry.fragmentShader);
    }
  };
  _View.prototype.createArrayBufferObject = function(data) {
    return engine.createArrayBufferObject(data);
  };
  mouseMoved = function(evt) {
    mouseX = evt.pageX;
    return mouseY = evt.pageY;
  };
  mousePressed = function() {
    curCoords[0] = mouseX;
    curCoords[1] = mouseY;
    return buttonDown = true;
  };
  mouseReleased = function() {
    return buttonDown = false;
  };
  attach = function(element, type, func) {
    if (element.addEventListener) {
      return element.addEventListener(type, func, false);
    } else {
      return element.attachEvent("on" + type, fn);
    }
  };
  return _View;
})();
View = new _View;