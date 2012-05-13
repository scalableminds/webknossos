### define
libs/gl_engine/lights : Lights
###

class GlEngine
############################################################################
  #private Properties
  gl : null
  canvas : null
  requestAnimationFrame = $.noop()

  PROJECTION_NEAR = 0.0001
  PROJECTION_FAR = 100000
  PROJECTION_ANGLE = 90


  # for calculating fps
  frames : 0
  frameCount : 0
  lastframerateTime : null

  # for throttling renderLoop
  lastLoopTime : null

  #to stop the animationLoop
  stopAnimation : false

  matrixStack : []
  projectionMatrix : null

  shaderProgram : null

############################################################################
  #public Properties
  framerate : 0
  # Contains reference to user's RenderingScript
  usersRender : $.noop()

############################################################################
  #public methods x


  constructor : (cvs, glAttribs) ->
    @lastframerateTime = new Date()
    @lastLoopTime = new Date()
    @frames = 0
    @canvas = cvs
    contextNames = [ "webgl", "experimental-webgl", "moz-webgl", "webkit-3d" ]
    i = 0

    for context in contextNames
      try
        @gl = cvs.getContext context, glAttribs 
        break if @gl

    alert "Your browser does not support WebGL."  unless @gl

    # initialize viewport and rendering matricies
    @setViewport()
    @createProjectionMatrix()

    normalMatrix = M4x4.I
    @lights = new Lights(@)
    @lights.addDirectionalLight [0.8, 0.8, 0.8], [0.2, 0.2, 0.5]

    @gl.disable(@gl.DEPTH_TEST)
    #@gl.depthFunc(@gl.GL_ALWAYS)
    @background [1, 1, 1, 1]

    #throttle renderLoop to run every 25ms -> max. 40 FPS (but rather 20FPS)
    @throttledRenderLoop = _.throttle( @renderLoop, 50)

    requestAnimationFrame = (->
      window.requestAnimationFrame or 
      window.webkitRequestAnimationFrame or 
      window.mozRequestAnimationFrame or 
      window.oRequestAnimationFrame or 
      window.msRequestAnimationFrame or 
      (callback, cvs) ->
            window.setTimeout callback, 1000.0 / 60.0
      )()

    # TESTING
    cubes = (new Uint8Array(1 << 15) for i in [0...64])
    console.time("load texture")
    cubeLen = 32^3 * (4^3)
    Xlen = 1024
    Ylen = 2048
    buffer = new Uint8Array(Xlen * Ylen)
    for i in [0...64]
      buffer.set(cubes[i], i << 15)
    texture = @gl.createTexture()
    @gl.bindTexture(@gl.TEXTURE_2D, texture)
    @gl.texImage2D(@gl.TEXTURE_2D, 0, @gl.ALPHA, Xlen, Ylen, 0, @gl.ALPHA, @gl.UNSIGNED_BYTE, buffer)
    console.timeEnd("load texture")


  setViewport : ->
    @gl.viewport 0, 0, parseInt(@canvas.width, 10), parseInt(@canvas.height, 10)

  ###
  Set a uniform integer
  @param {String} varName
  @param {Number} varValue
  ###
  uniformi : (varName, varValue) ->
    varLocation = @gl.getUniformLocation(@shaderProgram, varName)
    if varLocation?
      if varValue.length is 4
        @gl.uniform4iv varLocation, varValue
      else if varValue.length is 3
        @gl.uniform3iv varLocation, varValue
      else if varValue.length is 2
        @gl.uniform2iv varLocation, varValue
      else
        @gl.uniform1i varLocation, varValue
    else
      # console.log "uniform var '" + varName + "' was not found."

  ###
  Set a uniform float
  @param {String} varName
  @param {Number} varValue
  ###
  uniformf : (varName, varValue) ->
    varLocation = @gl.getUniformLocation(@shaderProgram, varName)
    if varLocation?
      if varValue.length is 4
        @gl.uniform4fv varLocation, varValue
      else if varValue.length is 3
        @gl.uniform3fv varLocation, varValue
      else if varValue.length is 2
        @gl.uniform2fv varLocation, varValue
      else
        @gl.uniform1f varLocation, varValue
    else
      # console.log "uniform var '" + varName + "' was not found."

  ###
  Sets a uniform matrix.
  @param {String} varName
  @param {Boolean} transpose must be false
  @param {Array} matrix
  ###
  uniformMatrix : (varName, transpose, matrix) ->
    varLocation = @gl.getUniformLocation(@shaderProgram, varName)
    if varLocation?
      if matrix.length is 16
        @gl.uniformMatrix4fv varLocation, transpose, matrix
      else if matrix.length is 9
        @gl.uniformMatrix3fv varLocation, transpose, matrix
      else
        @gl.uniformMatrix2fv varLocation, transpose, matrix
    else
      # console.log "Uniform matrix '" + varName + "' was not found."

  ###
  Create a buffer object which will contain
  the Vertex buffer object for the shader

  A 3D context must exist before calling this function

  @param {Array} data

  @returns {Object}
  ###

  createArrayBufferObject : (data) ->
    if @gl
      VBO = @gl.createBuffer()
      @gl.bindBuffer @gl.ARRAY_BUFFER, VBO
      @gl.bufferData @gl.ARRAY_BUFFER, data, @gl.STATIC_DRAW
      return VBO


  ###
  Create an ElementArrayBuffer object which will contain
  the Vertex buffer object for the shader

  A 3D context must exist before calling this function

  @param {Array} data

  @returns {Object}
  ###

  createElementArrayBufferObject : (data) ->
    if @gl
      VBO = @gl.createBuffer()
      @gl.bindBuffer @gl.ELEMENT_ARRAY_BUFFER, VBO
      @gl.bufferData @gl.ELEMENT_ARRAY_BUFFER, data, @gl.STATIC_DRAW
      return VBO
  ###
  deletes EBO of Geometry Object 
  @param {Geometry}
  ###
  deleteEBOBuffer : (geometry) ->
    @gl.deleteBuffer geometry.vertexIndex.EBO if geometry.getClassType is "Mesh"

  deleteSingleBuffer : (buffer) ->
    @gl.deleteBuffer buffer

  ###
  deletes VBO/EBOs of Geometry Object 
  @param {Geometry}
  ###
  deleteBuffer : (geometry) ->
    @gl.deleteBuffer geometry.vertices.VBO
    @gl.deleteBuffer geometry.colors.VBO if geometry.hasColors
    @gl.deleteBuffer geometry.normals.VBO if geometry.hasNormals

    @gl.deleteBuffer geometry.vertexIndex.EBO if geometry.getClassType is "Mesh"

  ###
  renders a geometry object
  @param {Geometry}
  ###
  render : (geometry) ->
    if @gl
      topMatrix = @peekMatrix()
      shaderProgram = @shaderProgram

      @uniformMatrix "modelViewMatrix", false, topMatrix

      if geometry.hasNormals
        @lights.setUniforms()
        normalMatrix = M4x4.inverseOrthonormal(topMatrix)
        @uniformMatrix "normalMatrix", false, M4x4.transpose normalMatrix
        @vertexAttribPointer "aNormal", 3, geometry.normals.VBO

      if geometry.hasColors
        @vertexAttribPointer "aColor", 3, geometry.colors.VBO
      
      if @gl.getAttribLocation(shaderProgram, "aVertex") > -1
        @vertexAttribPointer "aVertex", 3, geometry.vertices.VBO

      # render trianglesplanes
      if geometry.getClassType() is "Trianglesplane"
        @vertexAttribPointer "interpolationBuffer0", 4, geometry.interpolationBuffer0.VBO
        @vertexAttribPointer "interpolationBuffer1", 4, geometry.interpolationBuffer1.VBO
        @vertexAttribPointer "interpolationBufferDelta", 3, geometry.interpolationBufferDelta.VBO
        @gl.bindBuffer @gl.ELEMENT_ARRAY_BUFFER, geometry.vertexIndex.EBO
        @gl.drawElements @gl.TRIANGLES, geometry.vertexIndex.length, @gl.UNSIGNED_SHORT, 0
        
        @disableVertexAttribPointer "interpolationBuffer0"  
        @disableVertexAttribPointer "interpolationBuffer1"
        @disableVertexAttribPointer "interpolationBufferDelta"

      # render Meshes  
      else if geometry.getClassType() is "Mesh"
        @gl.bindBuffer @gl.ELEMENT_ARRAY_BUFFER, geometry.vertexIndex.EBO
        @gl.drawElements @gl.TRIANGLES, geometry.vertexIndex.length, @gl.UNSIGNED_SHORT, 0      

      @disableVertexAttribPointer "aVertex"
      @disableVertexAttribPointer "aColor" if geometry.colors.hasColor

      
  renderWireframe : (geometry, line_width = 2) ->

    # create a BufferObject filled with "black"
    unless @wireFrameColorBuffer 
      buffer = []
      for i in [0..1000]
        buffer.push(0,0,0)
      @wireFrameColorBuffer = @createArrayBufferObject(new Float32Array(buffer))

    if @gl
      topMatrix = @peekMatrix()
      @uniformMatrix "modelViewMatrix", false, topMatrix

      @gl.lineWidth(line_width)

      if @gl.getAttribLocation(@shaderProgram, "aColor") > -1
        @vertexAttribPointer "aColor", 3, @wireFrameColorBuffer
      
      if @gl.getAttribLocation(@shaderProgram, "aVertex") > -1
        @vertexAttribPointer "aVertex", 3, geometry.vertices.VBO

      @gl.drawElements @gl.LINES, geometry.vertexIndex.length, @gl.UNSIGNED_SHORT, 0    

  ###
  Sets the background color.
  @param {Array} color Array of 4 values ranging from 0 to 1.
  ###
  background : (color) ->
    @gl.clearColor color[0], color[1], color[2], color[3]
  
  ###
  Clears the color and depth buffers.
  ###
  clear : ->
    @gl.clear @gl.COLOR_BUFFER_BIT | @gl.DEPTH_BUFFER_BIT


  createProjectionMatrix : ->
    fovy = PROJECTION_ANGLE
    aspect = @canvas.width / @canvas.height
    near = PROJECTION_NEAR
    far = PROJECTION_FAR

    ymax = near * Math.tan(fovy * Math.PI / 360)
    ymin = -ymax
    xmin = ymin * aspect
    xmax = ymax * aspect
    X = 2 * near / (xmax - xmin)
    Y = 2 * near / (ymax - ymin)
    A = (xmax + xmin) / (xmax - xmin)
    B = (ymax + ymin) / (ymax - ymin)
    C = -(far + near) / (far - near)
    D = -2 * far * near / (far - near)
    @projectionMatrix = M4x4.$(X, 0, 0, 0, 0, Y, 0, 0, A, B, C, -1, 0, 0, D, 0)

  ###
  @param {String} vertexShaderSource
  @param {String} fragmentShaderSource
  ###     
  createShaderProgram : (vertexShaderSource, fragmentShaderSource) ->
    vertexShaderObject = @gl.createShader(@gl.VERTEX_SHADER)
    @gl.shaderSource vertexShaderObject, vertexShaderSource
    @gl.compileShader vertexShaderObject
    throw @gl.getShaderInfoLog(vertexShaderObject)  unless @gl.getShaderParameter(vertexShaderObject, @gl.COMPILE_STATUS)

    fragmentShaderObject = @gl.createShader(@gl.FRAGMENT_SHADER)
    @gl.shaderSource fragmentShaderObject, fragmentShaderSource
    @gl.compileShader fragmentShaderObject
    throw @gl.getShaderInfoLog(fragmentShaderObject)  unless @gl.getShaderParameter(fragmentShaderObject, @gl.COMPILE_STATUS)

    programObject = @gl.createProgram()
    @gl.attachShader programObject, vertexShaderObject
    @gl.attachShader programObject, fragmentShaderObject
    @gl.linkProgram programObject
    throw "Error linking shaders."  unless @gl.getProgramParameter(programObject, @gl.LINK_STATUS)
    
    #Sets shader Program 
    @shaderProgram = programObject

    return programObject

  ###
  Set a shader program to be used for rendering
  @shaderProgram is the currently acive global shader

  @param {ShaderProgram Object}
  ###
  useProgram : (program) ->
    @shaderProgram = program
    @gl.useProgram @shaderProgram
    @setDefaultUniforms()

  #################################
  # public properties

  Object.defineProperty(
    @prototype,
    "onRender",
    set: (func) ->
      @usersRender = func
    )

  Object.defineProperty(
    @prototype,
    "width",
    get: ->
      @canvas.width
    )
  
  Object.defineProperty(
    @prototype,
    "height",
    get: ->
      @canvas.height
    )

  ################################
  #Public MATRIX STACK OPERATIONS
  ################################

  ###
  Pushes on a copy of the matrix at the top of the matrix stack.
  @param {Float32Array} mat
  ###     
  pushMatrix : ->
    @matrixStack.push @peekMatrix()

  ###
  Pops off the matrix on top of the matrix stack.
  @param {Float32Array} mat
  ###
  popMatrix : ->
    @matrixStack.pop()

  ###
  Get a copy of the matrix at the top of the matrix stack.
  @param {Float32Array} mat
  ###
  peekMatrix : ->
    M4x4.clone @matrixStack[@matrixStack.length - 1]

  ###
  Set the matrix at the top of the matrix stack.
  @param {Float32Array} mat
  ###
  loadMatrix : (mat) ->
    @matrixStack[@matrixStack.length - 1] = mat

  multMatrix : (mat) ->
    @loadMatrix M4x4.mul @peekMatrix(), mat

  ##################################################
  # Public Modelview matrix math operations
  ##################################################
  ###
  Multiplies the top of the matrix stack with a uniformly scaled matrix.

  @param {Number} s
  ###
  scale : (sx, sy, sz) ->
    smat = (if (not sy and not sz) then M4x4.scale1(sx, M4x4.I) else M4x4.scale3(sx, sy, sz, M4x4.I))
    @loadMatrix M4x4.mul(@peekMatrix(), smat)
  

  ###
  Multiplies the top of the matrix stack with a translation matrix.

  @param {Number} tx
  @param {Number} ty
  @param {Number} tz
  ###
  translate : (tx, ty, tz) ->
    trans = M4x4.translate3(tx, ty, tz, M4x4.I)
    @loadMatrix M4x4.mul(@peekMatrix(), trans)
  

  ###
  Multiply the matrix at the top of the model view matrix
  stack with a rotation matrix about the x axis.

  @param {Number} radians
  ###
  rotateX : (radians) ->
    rotMat = M4x4.rotate(radians, V3.$(1,0,0), M4x4.I)
    @loadMatrix M4x4.mul(@peekMatrix(), rotMat)
  
  ###
  Multiply the matrix at the top of the model view matrix
  stack with a rotation matrix about the y axis.

  @param {Number} radians
  ###
  rotateY : (radians) ->
    rotMat = M4x4.rotate(radians, V3.$(0,1,0), M4x4.I)
    @loadMatrix M4x4.mul(@peekMatrix(), rotMat)

  ###
  Multiply the matrix at the top of the model view matrix
  stack with a rotation matrix about the z axis.

  @param {Number} radians
  ###
  rotateZ : (radians) ->
    rotMat = M4x4.rotate(radians, V3.$(0,0,1), M4x4.I)
    @loadMatrix M4x4.mul(@peekMatrix(), rotMat)

  rotate : (radians, a) ->
    rotMat = M4x4.rotate(radians, a, M4x4.I)
    @loadMatrix M4x4.mul(@peekMatrix(), rotMat)

  ###
  Calculate the 2d canvas position based on a 3D vector

  FIXME: Not working properly
  @param {Array} 3d vector
  ###
  get2dPoint : (vector) ->
    # transform world to clipping coordinates
    modelViewProjectionMatrix = M4x4.mul @projectionMatrix, @peekMatrix()
  
    V3.mul4x4 modelViewProjectionMatrix,vector,vector

    canvasX = Math.round ( ((1 -vector[0]) / 2) * @canvas.width)
    canvasY = Math.round ( ((1 - vector[1]) / 2) * @canvas.height)

    return [canvasX, canvasY]

  ###
  Calculate the 3d postion based on a 2d canvas position

  FIXME: Not working properly
  @param {Array} 2d vector
  ###
  get3dPoint : (vector, matrix) ->
    x = 2 * vector[0] / @canvas.width - 1
    y = -2 * vector[1] / @canvas.height + 1
                
    modelViewProjectionMatrix = M4x4.mul @projectionMatrix, matrix
    inverseMatrix = M4x4.inverse modelViewProjectionMatrix
    vector = []
    V3.mul4x4 inverseMatrix, [x,y,0], vector

    return vector


############################################################################
  #private methods

  ###
  @param {String} varName
  @param {Number} size
  @param {} VBO
  ###
  vertexAttribPointer : (varName, size, VBO) ->
    varLocation = @gl.getAttribLocation(@shaderProgram, varName)
    if varLocation > -1
      @gl.bindBuffer @gl.ARRAY_BUFFER, VBO
      @gl.vertexAttribPointer varLocation, size, @gl.FLOAT, false, 0, 0
      @gl.enableVertexAttribArray varLocation
    else
  
  ###
  @param {WebGLProgram} programObj
  @param {String} varName
  ###
  disableVertexAttribPointer : (varName) ->
    varLocation = @gl.getAttribLocation(@shaderProgram, varName)
    @gl.disableVertexAttribArray varLocation  if varLocation > -1  

      
  ###
  Animation loop is calling itself over and over
  ###
  animationLoop : =>
    requestAnimationFrame @animationLoop, @canvas unless @stopAnimation
    @throttledRenderLoop()


  ###
  main renderLoop
  calls usersRender() 
  function has been throttled with Underscore.js
  ###
  renderLoop : ->
    @frames++
    @frameCount++
    now = new Date()
    @lastLoopTime = now

    @matrixStack.push M4x4.I

    @usersRender(false)

    @matrixStack.pop()

    if now - @lastframerateTime > 1000
      @framerate = @frames / (now - @lastframerateTime) * 1000
      @frames = 0
      @lastframerateTime = now

    
  #apply a single draw
  draw : ->
    @matrixStack.push M4x4.I
    @usersRender(true)
    @matrixStack.pop()    

  ###
  Set all uniform variables for the shader
  ###
  setDefaultUniforms : ->
    @uniformMatrix "projectionMatrix", false, @projectionMatrix

  stopAnimationLoop : ->
    @stopAnimation = true

  startAnimationLoop : ->
    @stopAnimation = false
    @animationLoop()
