class GL_engine
############################################################################
	#private Properties
	empty_func = -> 
	gl = null
	canvas = null
	requestAnimationFrame = empty_func


	# for calculating fps
	frames = 0
	frameCount = 0
	lastTime = null
	
	matrixStack = []

	programCaches = []
	geometry = []

	attn = [0.01, 0.0, 0.003]

	projectionMatrix = null

############################################################################
	#public Properties
	VERSION = 0.1
	frameRate = 0
	# Contains reference to user's RenderingScript
	usersRender = empty_func
	shaderProgram = null

############################################################################
	#public methods 


	constructor: (cvs, glAttribs) ->
		lastTime = new Date()
		frames = 0
		canvas = cvs
		contextNames = [ "webgl", "experimental-webgl", "moz-webgl", "webkit-3d" ]
		i = 0

		while i < contextNames.length
			try
				gl = cvs.getContext(contextNames[i], glAttribs)
				break  if gl
			i++

		alert "Your browser does not support WebGL."  unless gl
		gl.viewport 0, 0, parseInt(canvas.width, 10), parseInt(canvas.height, 10)
		@perspective()
		normalMatrix = M4x4.I

		gl.enable(gl.DEPTH_TEST)
		@background [1, 1, 1, 1]
	
		requestAnimationFrame = (->
			window.requestAnimationFrame or 
			window.webkitRequestAnimationFrame or 
			window.mozRequestAnimationFrame or 
			window.oRequestAnimationFrame or 
			window.msRequestAnimationFrame or 
			(callback, cvs) ->
    	window.setTimeout callback, 1000.0 / 60.0
			)()

		animationLoop()



	###
	Set a uniform integer
	@param {String} varName
	@param {Number} varValue
	###
	uniformi : (varName, varValue) ->
		varLocation = gl.getUniformLocation(shaderProgram, varName)
		if varLocation isnt null
			if varValue.length is 4
				gl.uniform4iv varLocation, varValue
			else if varValue.length is 3
				gl.uniform3iv varLocation, varValue
			else if varValue.length is 2
				gl.uniform2iv varLocation, varValue
			else
				gl.uniform1i varLocation, varValue
		else
			console.log "uniform var '" + varName + "' was not found."

	###
	Set a uniform float
	@param {String} varName
	@param {Number} varValue
	###
	uniformf : (varName, varValue) ->
		varLocation = gl.getUniformLocation(shaderProgram, varName)
		if varLocation isnt null
			if varValue.length is 4
				gl.uniform4fv varLocation, varValue
			else if varValue.length is 3
				gl.uniform3fv varLocation, varValue
			else if varValue.length is 2
				gl.uniform2fv varLocation, varValue
			else
				gl.uniform1f varLocation, varValue
		else
			console.log "uniform var '" + varName + "' was not found."

	###
	Sets a uniform matrix.
	@param {String} varName
	@param {Boolean} transpose must be false
	@param {Array} matrix
	###
	uniformMatrix : (varName, transpose, matrix) ->
		varLocation = gl.getUniformLocation(shaderProgram, varName)
		if varLocation isnt null
			if matrix.length is 16
				gl.uniformMatrix4fv varLocation, transpose, matrix
			else if matrix.length is 9
				gl.uniformMatrix3fv varLocation, transpose, matrix
			else
				gl.uniformMatrix2fv varLocation, transpose, matrix
		else
			console.log "Uniform matrix '" + varName + "' was not found."

	###
	Create a buffer object which will contain
	the Vertex buffer object for the shader

	A 3D context must exist before calling this function

	@param {Array} data

	@returns {Object}
	###

	createArrayBufferObject : (data) ->
		if gl
			VBO = gl.createBuffer()
			gl.bindBuffer gl.ARRAY_BUFFER, VBO
			gl.bufferData gl.ARRAY_BUFFER, data, gl.STATIC_DRAW
			return VBO


	###
	Create an ElementArrayBuffer object which will contain
	the Vertex buffer object for the shader

	A 3D context must exist before calling this function

	@param {Array} data

	@returns {Object}
	###

	createElementArrayBufferObject : (data) ->
		if gl
			VBO = gl.createBuffer()
			gl.bindBuffer gl.ELEMENT_ARRAY_BUFFER, VBO
			gl.bufferData gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW
			return VBO

	###
	deletes VBO/EBOs of Geometry Object 
	@param {Geometry}
	###
	deleteBuffer : (geometry) ->
		gl.deleteBuffer geometry.vertices.VBO
		gl.deleteBuffer geometry.colors.VBO if geometry.hasColors
		gl.deleteBuffer geometry.normals.VBO if geometry.hasNormals

		gl.deleteBuffer geometry.vertexIndex.EBO if geometry.getClassType is "Mesh"

	###
	renders a geometry object
	@param {Geometry}
	###
	render : (geometry) ->
		if gl
			topMatrix = @peekMatrix()
			@uniformMatrix "modelViewMatrix", false, topMatrix

			if geometry.hasNormals
				normalMatrix = M4x4.inverseOrthonormal(topMatrix);	
				@uniformMatrix "normalMatrix", false, M4x4.transpose normalMatrix
			# enable Attribute pointers/ bind buffers
			if geometry.hasColors
				if gl.getAttribLocation(shaderProgram, "aColor") isnt -1
					vertexAttribPointer "aColor", 3, geometry.colors.VBO


			if gl.getAttribLocation(shaderProgram, "aVertex") isnt -1
				vertexAttribPointer "aVertex", 3, geometry.vertices.VBO

			# render everything to screen
			if geometry.getClassType() is "Mesh"
				gl.bindBuffer gl.ELEMENT_ARRAY_BUFFER, geometry.vertexIndex.EBO
				gl.drawElemets gl.TRIANGLES, geometry.vertexIndex.length, gl.UNSIGNED_SHORT, 0
			else
				gl.drawArrays gl.POINTS, 0, geometry.vertices.length / 3

			disableVertexAttribPointer "aVertex"
			disableVertexAttribPointer "aColor" if geometry.colors.hasColor



	###
	Sets the background color.
	@param {Array} color Array of 4 values ranging from 0 to 1.
	###
	background : (color) ->
		gl.clearColor color[0], color[1], color[2], color[3]
	
	###
	Clears the color and depth buffers.
	###
	clear : ->
		gl.clear gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT


	###
	@param {Number} size - in pixels	
	###
	pointSize : (size) ->
		@uniformf "pointSize", size


	###
	Set the point attenuation factors.	
	@param {Number} constant
	@param {Number} linear
	@param {Number} quadratic	
	###
	attenuation : (constant, linear, quadratic) ->
		@uniformf "attenuation", [constant, linear, quadratic]

	perspective : (fovy, aspect, near, far) ->

		if arguments.length is 0
			fovy = 60
			aspect = canvas.width / canvas.height
			near = 0.1
			far = 1000

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
		projectionMatrix = M4x4.$(X, 0, 0, 0, 0, Y, 0, 0, A, B, C, -1, 0, 0, D, 0)
		@uniformMatrix "projectionMatrix", false, projectionMatrix  if shaderProgram

	onRender : (func) ->
		usersRender = func

	getHeight : ->
		return canvas.height

	getWidth : ->
		return canvas.width


	getFramerate: ->
		return frameRate

	@__defineGetter__ "height", ->
		canvas.height

	@__defineGetter__ "width", ->
		canvas.width
	
	@__defineGetter__ "frameRate", ->
		frameRate
	
	@__defineGetter__ "VERSION", ->
		VERSION










	################################
	#Public MATRIX STACK OPERATIONS
	################################

	###
	Pushes on a copy of the matrix at the top of the matrix stack.
	@param {Float32Array} mat
	###		 
	pushMatrix : ->
		matrixStack.push @peekMatrix()

	###
	Pops off the matrix on top of the matrix stack.
	@param {Float32Array} mat
	###
	popMatrix : ->
		matrixStack.pop()

	###
	Get a copy of the matrix at the top of the matrix stack.
	@param {Float32Array} mat
	###
	peekMatrix : ->
		M4x4.clone matrixStack[matrixStack.length - 1]

	###
	Set the matrix at the top of the matrix stack.
	@param {Float32Array} mat
	###
	loadMatrix : (mat) ->
		matrixStack[matrixStack.length - 1] = mat

	multMatrix : (mat) ->
		@loadMatrix M4x4.mul @peekMatrix(), mat

	##################################################
	# Public Modelview matrix math operations
	##################################################
	###
	@name PointStream#scale
	@function

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
		loadMatrix M4x4.mul(@peekMatrix(), rotMat)

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
    

############################################################################
	#private methods

	###
	@param {String} varName
	@param {Number} size
	@param {} VBO
	###
	vertexAttribPointer = (varName, size, VBO) ->
		varLocation = gl.getAttribLocation(shaderProgram, varName)
		if varLocation isnt -1
			gl.bindBuffer gl.ARRAY_BUFFER, VBO
			gl.vertexAttribPointer varLocation, size, gl.FLOAT, false, 0, 0
			gl.enableVertexAttribArray varLocation
		else
	
	###
	@param {WebGLProgram} programObj
	@param {String} varName
	###
	disableVertexAttribPointer = (varName) ->
		varLocation = gl.getAttribLocation(shaderProgram, varName)
		gl.disableVertexAttribArray varLocation  if varLocation isnt -1	

			
	###
	@param {String} vertexShaderSource
	@param {String} fragmentShaderSource
	###		 
	createShaderProgram : (vertexShaderSource, fragmentShaderSource) ->
		vertexShaderObject = gl.createShader(gl.VERTEX_SHADER)
		gl.shaderSource vertexShaderObject, vertexShaderSource
		gl.compileShader vertexShaderObject
		throw gl.getShaderInfoLog(vertexShaderObject)  unless gl.getShaderParameter(vertexShaderObject, gl.COMPILE_STATUS)

		fragmentShaderObject = gl.createShader(gl.FRAGMENT_SHADER)
		gl.shaderSource fragmentShaderObject, fragmentShaderSource
		gl.compileShader fragmentShaderObject
		throw gl.getShaderInfoLog(fragmentShaderObject)  unless gl.getShaderParameter(fragmentShaderObject, gl.COMPILE_STATUS)

		programObject = gl.createProgram()
		gl.attachShader programObject, vertexShaderObject
		gl.attachShader programObject, fragmentShaderObject
		gl.linkProgram programObject
		throw "Error linking shaders."  unless gl.getProgramParameter(programObject, gl.LINK_STATUS)
		
		shaderProgram = programObject
		
		#Tell WebGL to use shader
		@useProgram shaderProgram

		return programObject


	useProgram : (program) ->
		shaderProgram = program
		gl.useProgram shaderProgram
		alreadySet = false
		i = 0

		while i < programCaches.length
			alreadySet = true  if shaderProgram and programCaches[i] is shaderProgram
			i++

		if alreadySet is false
			@setDefaultUniforms()
			programCaches.push shaderProgram


	animationLoop = ->
		renderLoop()
		requestAnimationFrame animationLoop, canvas


	###
	main renderLoop
	calls usersRender() 
	###
	renderLoop = ->
		frames++
		frameCount++
		now = new Date()

		matrixStack.push M4x4.I

		usersRender()

		matrixStack.pop()

		if now - lastTime > 1000
			frameRate = frames / (now - lastTime) * 1000
			frames = 0
			lastTime = now




	setDefaultUniforms : ->
		@uniformf "pointSize", 1
		@uniformf "attenuation", [ attn[0], attn[1], attn[2] ]
		@uniformMatrix "projectionMatrix", false, projectionMatrix




# weiter mit 1400


















