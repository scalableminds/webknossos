class GL_engine
############################################################################
	#private Properties
	empty_func = -> 
	gl = null
	canvas = null


	# for calculating fps
	frames = 0
	frameRate = 0
	frameCount = 0
	lastTime
	
	matrixStack = null

############################################################################
	#public Properties
	VERSION = 0.1
	# Contains reference to user's RenderingScript
	usersRender = empty_func
	geometry = []
	shaderProgram = null

############################################################################
	#public methods 

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
			VBO = gl.CreateBuffer()
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
			VBO = gl.CreateBuffer()
			gl.bindBuffer gl.ELEMENT_ARRAY_BUFFER, VBO
			gl.bufferData gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW
			return VBO

	###
	deletes VBO/EBOs of Geometry Object 
	@param {Geometry}
	###
	deleteBuffer : (geometry) ->
		gl.deleteBuffer geometry.vertices.VBO
		gl.deleteBuffer geometry.colors.VBO if geometry.colors.hasColors
		gl.deleteBuffer geometry.normals.VBO if geometry.normals.hasNormals

		gl.deleteBuffer geometry.vertexIndex.EBO if geometry.getClassType is "Mesh"

	render


	###
	Get the height of the canvas.
	@name GL_engine#height
	@returns {Number}
	###	
	@__defineGetter__ "height", ->
		canvas.height

	###
	Get the width of the canvas.
	@name GL_engine#height
	@returns {Number}
	###	
	@__defineGetter__ "width", ->
		canvas.width

	###
	Get the framerate of GL_engine.
	@name GL_engine#framerate
	@returns {Number}
	###	
	@__defineGetter__ "frameRate", ->
		frameRate

	###
	Sets the background color.
	@param {Array} color Array of 4 values ranging from 0 to 1.
	###
	@background = (color) ->
		gl.clearColor color[0], color[1], color[2], color[3]
	
	###
	Clears the color and depth buffers.
	###
	@clear = ->
		gl.clear gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT

		 


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
	disableVertexAttribPointer = (programObj, varName) ->
		varLocation = gl.getAttribLocation(programObj, varName)
		gl.disableVertexAttribArray varLocation  if varLocation isnt -1	

			
	###
	@param {String} vetexShaderSource
	@param {String} fragmentShaderSource
	###		 
	createProgramObject = (vetexShaderSource, fragmentShaderSource) ->
		vertexShaderObject = gl.createShader(gl.VERTEX_SHADER)
		gl.shaderSource vertexShaderObject, vetexShaderSource
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
		
		return programObject





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


	setDefaultUniforms = ->
		uniformf currProgram, "pointSize", 1
		uniformf currProgram, "attenuation", [ attn[0], attn[1], attn[2] ]
		uniformMatrix currProgram, "projectionMatrix", false, projectionMatrix

	


# weiter mit 909


















