var GL_engine;
GL_engine = (function() {
  var VERSION, canvas, createProgramObject, disableVertexAttribPointer, empty_func, frameCount, frameRate, frames, geometry, gl, matrixStack, renderLoop, setDefaultUniforms, shaderProgram, usersRender, vertexAttribPointer;
  function GL_engine() {}
  empty_func = function() {};
  gl = null;
  canvas = null;
  frames = 0;
  frameRate = 0;
  frameCount = 0;
  lastTime;
  matrixStack = null;
  VERSION = 0.1;
  usersRender = empty_func;
  geometry = [];
  shaderProgram = null;
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
  render;
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
  	Sets the background color.
  	@param {Array} color Array of 4 values ranging from 0 to 1.
  	*/
  GL_engine.background = function(color) {
    return gl.clearColor(color[0], color[1], color[2], color[3]);
  };
  /*
  	Clears the color and depth buffers.
  	*/
  GL_engine.clear = function() {
    return gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
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
  createProgramObject = function(vetexShaderSource, fragmentShaderSource) {
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
    return programObject;
  };
  /*
  	main renderLoop
  	calls usersRender() 
  	*/
  renderLoop = function() {
    var lastTime, now;
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
    uniformf(currProgram, "pointSize", 1);
    uniformf(currProgram, "attenuation", [attn[0], attn[1], attn[2]]);
    return uniformMatrix(currProgram, "projectionMatrix", false, projectionMatrix);
  };
  return GL_engine;
})();