var GL_engine;
GL_engine = (function() {
  var VERSION, canvas, createProgramObject, disableVertexAttribPointer, empty_func, frameCount, frameRate, frames, geometry, gl, shaderProgram, usersRender, vertexAttribPointer;
  function GL_engine() {}
  empty_func = function() {};
  gl = null;
  canvas = null;
  frames = 0;
  frameRate = 0;
  frameCount = 0;
  lastTime;
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
  	@param {Boolean} isElementBuffer
  
  	@returns {Object}
  	*/
  GL_engine.prototype.createBufferObject = function(data, isElementBuffer) {
    var VBO;
    if (isElementBuffer == null) {
      isElementBuffer = false;
    }
    if (gl) {
      VBO = gl.CreateBuffer();
      if (isElemetBuffer) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, VBO);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, VBO);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      }
      return VBO;
    }
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
  return GL_engine;
})();