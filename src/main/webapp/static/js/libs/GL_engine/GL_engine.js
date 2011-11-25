var GL_engine;
GL_engine = (function() {
  var VERSION, animationLoop, canvas, createShaderProgram, disableVertexAttribPointer, empty_func, frameCount, frameRate, frames, geometry, gl, lastTime, matrixStack, perspective, programCaches, renderLoop, requestAnimationFrame, setDefaultUniforms, shaderProgram, useProgram, usersRender, vertexAttribPointer;
  empty_func = function() {};
  gl = null;
  canvas = null;
  frames = 0;
  frameCount = 0;
  lastTime = null;
  matrixStack = null;
  programCaches = [];
  VERSION = 0.1;
  frameRate = 0;
  usersRender = empty_func;
  geometry = [];
  shaderProgram = null;
  function GL_engine(cvs, glAttribs) {
    var contextNames, i, normalMatrix;
    lastTime = new Date();
    frames = 0;
    contextNames = ["webgl", "experimental-webgl", "moz-webgl", "webkit-3d"];
    i = 0;
    while (i < contextNames.length) {
      try {
        gl = cvs.getContext(contextNames[i], glAttribs);
        if (gl) {
          break;
        }
      } catch (_e) {}
      i++;
    }
    if (!gl) {
      alert("Your browser does not support WebGL.");
    }
    gl.viewport(0, 0, parseInt(cvs.width, 10), parseInt(cvs.height, 10));
    perspective();
    normalMatrix = M4x4.I;
    gl.enable(gl.DEPTH_TEST);
    background([1, 1, 1, 1]);
    animationLoop();
  }
  /*
  	Set a uniform integer
  	@param {String} varName
  	@param {Number} varValue
  	*/
  GL_engine.prototype.uniformi = function(varName, varValue) {
    var varLocation;
    varLocation = gl.getUniformLocation(shaderProgram, varName);
    if (varLocation !== null) {
      if (varValue.length === 4) {
        gl.uniform4iv(varLocation, varValue);
      } else if (varValue.length === 3) {
        gl.uniform3iv(varLocation, varValue);
      } else if (varValue.length === 2) {
        gl.uniform2iv(varLocation, varValue);
      } else {
        gl.uniform1i(varLocation, varValue);
      }
    } else {

    }
    return console.log("uniform var '" + varName + "' was not found.");
  };
  /*
  	Set a uniform float
  	@param {String} varName
  	@param {Number} varValue
  	*/
  GL_engine.prototype.uniformf = function(varName, varValue) {
    var varLocation;
    varLocation = gl.getUniformLocation(shaderProgram, varName);
    if (varLocation !== null) {
      if (varValue.length === 4) {
        gl.uniform4fv(varLocation, varValue);
      } else if (varValue.length === 3) {
        gl.uniform3fv(varLocation, varValue);
      } else if (varValue.length === 2) {
        gl.uniform2fv(varLocation, varValue);
      } else {
        gl.uniform1f(varLocation, varValue);
      }
    } else {

    }
    return console.log("uniform var '" + varName + "' was not found.");
  };
  /*
  	Sets a uniform matrix.
  	@param {String} varName
  	@param {Boolean} transpose must be false
  	@param {Array} matrix
  	*/
  GL_engine.prototype.uniformMatrix = function(varName, transpose, matrix) {
    var varLocation;
    varLocation = gl.getUniformLocation(shaderProgram, varName);
    if (varLocation !== null) {
      if (matrix.length === 16) {
        gl.uniformMatrix4fv(varLocation, transpose, matrix);
      } else if (matrix.length === 9) {
        gl.uniformMatrix3fv(varLocation, transpose, matrix);
      } else {
        gl.uniformMatrix2fv(varLocation, transpose, matrix);
      }
    } else {

    }
    return console.log("Uniform matrix '" + varName + "' was not found.");
  };
  /*
  	Create a buffer object which will contain
  	the Vertex buffer object for the shader
  
  	A 3D context must exist before calling this function
  
  	@param {Array} data
  
  	@returns {Object}
  	*/
  GL_engine.prototype.createArrayBufferObject = function(data) {
    var VBO;
    if (gl) {
      VBO = gl.CreateBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, VBO);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return VBO;
    }
  };
  /*
  	Create an ElementArrayBuffer object which will contain
  	the Vertex buffer object for the shader
  
  	A 3D context must exist before calling this function
  
  	@param {Array} data
  
  	@returns {Object}
  	*/
  GL_engine.prototype.createElementArrayBufferObject = function(data) {
    var VBO;
    if (gl) {
      VBO = gl.CreateBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, VBO);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return VBO;
    }
  };
  /*
  	deletes VBO/EBOs of Geometry Object 
  	@param {Geometry}
  	*/
  GL_engine.prototype.deleteBuffer = function(geometry) {
    gl.deleteBuffer(geometry.vertices.VBO);
    if (geometry.colors.hasColors) {
      gl.deleteBuffer(geometry.colors.VBO);
    }
    if (geometry.normals.hasNormals) {
      gl.deleteBuffer(geometry.normals.VBO);
    }
    if (geometry.getClassType === "Mesh") {
      return gl.deleteBuffer(geometry.vertexIndex.EBO);
    }
  };
  /*
  	renders a geometry object
  	@param {Geometry}
  	*/
  GL_engine.prototype.render = function(geometry) {
    var normalMatrix, topMatrix;
    if (gl) {
      topMatrix = peekMatrix();
      uniformMatrix(shaderProgram, "modelViewMatrix", false, topMatrix);
      if (geometry.normals.hasNormals) {
        normalMatrix = M4x4.inverseOrthonormal(topMatrix);
        uniformMatrix(shaderProgram, "normalMatrix", false, M4x4.transpose(normalMatrix));
      }
      if (geometry.colors.hasColors) {
        if (gl.getAttribLocation(shaderProgram, "aColor")(isNot(-1))) {
          vertexAttribPointer(shaderProgram, "aColor", 3, geometry.colors.VBO);
        }
      }
      if (gl.getAttribLocation(shaderProgram, "aVertex")(isNot(-1))) {
        vertexAttribPointer(shaderProgram, "aVertex", 3, geometry.vertices.VBO);
      }
      if (geometry.getClass() === "Mesh") {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.vertexIndex.EBO);
        gl.drawElemets(gl.TRIANGLES, geometry.vertexIndex.length, gl.UNSIGNED_SHORT, 0);
      } else {
        gl.drawArrays(gl.POINTS, 0, geometry.vertices.length / 3);
      }
      disableVertexAttribPointer(shaderProgram, "aVertex");
      if (geometry.colors.hasColor) {
        return disableVertexAttribPointer(shaderProgram, "aColor");
      }
    }
  };
  /*
  	Sets the background color.
  	@param {Array} color Array of 4 values ranging from 0 to 1.
  	*/
  GL_engine.prototype.background = function(color) {
    return gl.clearColor(color[0], color[1], color[2], color[3]);
  };
  /*
  	Clears the color and depth buffers.
  	*/
  GL_engine.prototype.clear = function() {
    return gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  };
  /*
  	@param {Number} size - in pixels	
  	*/
  GL_engine.prototype.pointSize = function(size) {
    return uniformf(shaderProgram, "pointSize", size);
  };
  /*
  	Set the point attenuation factors.	
  	@param {Number} constant
  	@param {Number} linear
  	@param {Number} quadratic	
  	*/
  GL_engine.prototype.attenuation = function(constant, linear, quadratic) {
    return uniformf(shaderProgram, "attenuation", [constant, linear, quadratic]);
  };
  perspective = function(fovy, aspect, near, far) {
    var A, B, C, D, X, Y, projectionMatrix, xmax, xmin, ymax, ymin;
    if (arguments.length === 0) {
      fovy = 60;
      aspect = width / height;
      near = 0.1;
      far = 1000;
    }
    ymax = near * Math.tan(fovy * Math.PI / 360);
    ymin = -ymax;
    xmin = ymin * aspect;
    xmax = ymax * aspect;
    X = 2 * near / (xmax - xmin);
    Y = 2 * near / (ymax - ymin);
    A = (xmax + xmin) / (xmax - xmin);
    B = (ymax + ymin) / (ymax - ymin);
    C = -(far + near) / (far - near);
    D = -2 * far * near / (far - near);
    projectionMatrix = M4x4.$(X, 0, 0, 0, 0, Y, 0, 0, A, B, C, -1, 0, 0, D, 0);
    if (shaderProgram) {
      return uniformMatrix(shaderProgram, "projectionMatrix", false, projectionMatrix);
    }
  };
  /*
  	Get the height of the canvas.
  	@name GL_engine#height
  	@returns {Number}
  	*/
  GL_engine.__defineGetter__("height", function() {
    return canvas.height;
  });
  /*
  	Get the width of the canvas.
  	@name GL_engine#height
  	@returns {Number}
  	*/
  GL_engine.__defineGetter__("width", function() {
    return canvas.width;
  });
  /*
  	Get the framerate of GL_engine.
  	@name GL_engine#framerate
  	@returns {Number}
  	*/
  GL_engine.__defineGetter__("frameRate", function() {
    return frameRate;
  });
  /*
  	Get the VERSION of GL_engine.
  	@name GL_engine#VERSION
  	@returns {Number}
  	*/
  GL_engine.__defineGetter__("VERSION", function() {
    return VERSION;
  });
  /*
  	Set the external user's render function
  	@name GL_engine#framerate
  	@returns {Number}
  	*/
  GL_engine.__defineSetter__("usersRender", function(val) {
    return usersRender = val;
  });
  /*
  	Pushes on a copy of the matrix at the top of the matrix stack.
  	@param {Float32Array} mat
  	*/
  GL_engine.prototype.pushMatrix = function() {
    return matrixStack.push(peekMatrix());
  };
  /*
  	Pops off the matrix on top of the matrix stack.
  	@param {Float32Array} mat
  	*/
  GL_engine.prototype.popMatrix = function() {
    return matrixStack.pop();
  };
  /*
  	Get a copy of the matrix at the top of the matrix stack.
  	@param {Float32Array} mat
  	*/
  GL_engine.prototype.peekMatrix = function() {
    return M4x4.clone(matrixStack[matrixStack.length - 1]);
  };
  /*
  	Set the matrix at the top of the matrix stack.
  	@param {Float32Array} mat
  	*/
  GL_engine.prototype.loadMatrix = function(mat) {
    return matrixStack[matrixStack.length - 1] = mat;
  };
  GL_engine.prototype.multMatrix = function(mat) {
    return loadMatrix(M4x4.mul(peekMatrix(), mat));
  };
  /*
  	@name PointStream#scale
  	@function
  
  	Multiplies the top of the matrix stack with a uniformly scaled matrix.
  
  	@param {Number} s
  	*/
  GL_engine.prototype.scale = function(sx, sy, sz) {
    var smat;
    smat = (!sy && !sz ? M4x4.scale1(sx, M4x4.I) : M4x4.scale3(sx, sy, sz, M4x4.I));
    return loadMatrix(M4x4.mul(peekMatrix(), smat));
  };
  /*
  	Multiplies the top of the matrix stack with a translation matrix.
  
  	@param {Number} tx
  	@param {Number} ty
  	@param {Number} tz
  	*/
  GL_engine.prototype.translate = function(tx, ty, tz) {
    var trans;
    trans = M4x4.translate3(tx, ty, tz, M4x4.I);
    return loadMatrix(M4x4.mul(peekMatrix(), trans));
  };
  /*
  	Multiply the matrix at the top of the model view matrix
  	stack with a rotation matrix about the x axis.
  
  	@param {Number} radians
  	*/
  GL_engine.prototype.rotateX = function(radians) {
    var rotMat;
    rotMat = M4x4.rotate(radians, V3.$(1, 0, 0), M4x4.I);
    return loadMatrix(M4x4.mul(peekMatrix(), rotMat));
  };
  /*
  	Multiply the matrix at the top of the model view matrix
  	stack with a rotation matrix about the y axis.
  
  	@param {Number} radians
  	*/
  GL_engine.prototype.rotateY = function(radians) {
    var rotMat;
    rotMat = M4x4.rotate(radians, V3.$(0, 1, 0), M4x4.I);
    return loadMatrix(M4x4.mul(peekMatrix(), rotMat));
  };
  /*
  	Multiply the matrix at the top of the model view matrix
  	stack with a rotation matrix about the z axis.
  
  	@param {Number} radians
  	*/
  GL_engine.prototype.rotateZ = function(radians) {
    var rotMat;
    rotMat = M4x4.rotate(radians, V3.$(0, 0, 1), M4x4.I);
    return loadMatrix(M4x4.mul(peekMatrix(), rotMat));
  };
  GL_engine.prototype.rotate = function(radians, a) {
    var rotMat;
    rotMat = M4x4.rotate(radians, a, M4x4.I);
    return loadMatrix(M4x4.mul(peekMatrix(), rotMat));
  };
  /*
  	@param {String} varName
  	@param {Number} size
  	@param {} VBO
  	*/
  vertexAttribPointer = function(varName, size, VBO) {
    var varLocation;
    varLocation = gl.getAttribLocation(shaderProgram, varName);
    if (varLocation !== -1) {
      gl.bindBuffer(gl.ARRAY_BUFFER, VBO);
      gl.vertexAttribPointer(varLocation, size, gl.FLOAT, false, 0, 0);
      return gl.enableVertexAttribArray(varLocation);
    } else {

    }
  };
  /*
  	@param {WebGLProgram} programObj
  	@param {String} varName
  	*/
  disableVertexAttribPointer = function(programObj, varName) {
    var varLocation;
    varLocation = gl.getAttribLocation(programObj, varName);
    if (varLocation !== -1) {
      return gl.disableVertexAttribArray(varLocation);
    }
  };
  /*
  	@param {String} vetexShaderSource
  	@param {String} fragmentShaderSource
  	*/
  createShaderProgram = function(vetexShaderSource, fragmentShaderSource) {
    var fragmentShaderObject, programObject, vertexShaderObject;
    vertexShaderObject = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShaderObject, vetexShaderSource);
    gl.compileShader(vertexShaderObject);
    if (!gl.getShaderParameter(vertexShaderObject, gl.COMPILE_STATUS)) {
      throw gl.getShaderInfoLog(vertexShaderObject);
    }
    fragmentShaderObject = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShaderObject, fragmentShaderSource);
    gl.compileShader(fragmentShaderObject);
    if (!gl.getShaderParameter(fragmentShaderObject, gl.COMPILE_STATUS)) {
      throw gl.getShaderInfoLog(fragmentShaderObject);
    }
    programObject = gl.createProgram();
    gl.attachShader(programObject, vertexShaderObject);
    gl.attachShader(programObject, fragmentShaderObject);
    gl.linkProgram(programObject);
    if (!gl.getProgramParameter(programObject, gl.LINK_STATUS)) {
      throw "Error linking shaders.";
    }
    shaderProgram = programObject;
    gl.useProgram(shaderProgram);
    setDefaultUniforms();
    return programObject;
  };
  requestAnimationFrame = function() {
    return window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame || window.oRequestAnimationFrame || window.msRequestAnimationFrame || function(callback) {
      return window.setTimeout(callback, 1000.0 / 60.0);
    };
  };
  animationLoop = function() {
    renderLoop();
    return PSrequestAnimationFrame(animationLoop);
  };
  /*
  	main renderLoop
  	calls usersRender() 
  	*/
  renderLoop = function() {
    var now;
    frames++;
    frameCount++;
    now = new Date();
    matrixStack.push(M4x4.I);
    usersRender();
    matrixStack.pop();
    if (now - lastTime > 1000) {
      frameRate = frames / (now - lastTime) * 1000;
      frames = 0;
      return lastTime = now;
    }
  };
  setDefaultUniforms = function() {
    uniformf(shaderProgram, "pointSize", 1);
    uniformf(shaderProgram, "attenuation", [attn[0], attn[1], attn[2]]);
    return uniformMatrix(shaderProgram, "projectionMatrix", false, projectionMatrix);
  };
  useProgram = function(program) {
    var alreadySet, i;
    shaderProgram = program;
    gl.useProgram(shaderProgram);
    alreadySet = false;
    i = 0;
    while (i < programCaches.length) {
      if (shaderProgram && programCaches[i] === shaderProgram) {
        alreadySet = true;
      }
      i++;
    }
    if (alreadySet === false) {
      setDefaultUniforms();
      return programCaches.push(shaderProgram);
    }
  };
  return GL_engine;
})();