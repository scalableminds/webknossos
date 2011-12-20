class _View

	engine = undefined
	cam = undefined
	cvs = undefined
	geometries = []
	keyboard = null

	#ProgramObjects
	#One Shader for each Geometry-Type
	meshProgramObject = null
	pointcloudProgramObject = null

	#mouse (not used)
	buttonDown = false
	lastx = 0
	lasty = 0
	mouseX = 0
	mouseY = 0
	rot = [0, 0]
	curCoords = [0, 0]

	#constants
	clippingDistance = 28
	camPos = [6.35,6.35,-clippingDistance+6.35]
	moveValueStrafe = 0.1
	moveValueRotate = 0.02


	constructor: () -> 
		cvs = document.getElementById('render')
		engine = new GL_engine cvs, {"antialias":true}

		cam = new Flycam(clippingDistance)
		cam.move camPos
		#cam.move [+6.3,0,0]

		engine.background [0.9, 0.9 ,0.9 ,1]
		engine.pointSize 10
		engine.perspective 30, cvs.width / cvs.height, clippingDistance, clippingDistance + 0.1 

		engine.onRender renderFunction

		keyboard = new Keyboard

		#Mouse
		attach cvs, "mousemove", mouseMoved
		attach cvs, "mouseup", mouseReleased
		attach cvs, "mousedown", mousePressed

		#Keyboard
		attach document, "keydown", keyDown
		#attach document, "keypress", keyPressed
		attach document, "keyup", keyUp


# #####################
# MAIN FUNCTIONS
# #####################

	#main render function
	renderFunction = ->
		makeMovement()
		#sets view to camera position and direction
		engine.loadMatrix (M4x4.makeLookAt cam.getPos(), V3.add(cam.getDir(), cam.getPos()) , cam.getUp())
		engine.clear()

		#renders all geometries in geometry-array
		totalNumberOfVertices = 0
		for i in [0...geometries.length] by 1
			engine.useProgram = meshProgramObject if geometries[i].getClassType() is "Mesh"
			engine.useProgram = pointcloudProgramObject if geometries[i].getClassType() is "Pointcloud"
			#counts vertices of all geometries
			totalNumberOfVertices += geometries[i].vertices.length
			engine.render geometries[i]
			
		# OUTPUT Framerate
		status = document.getElementById('status')
		status.innerHTML = "#{Math.floor(engine.getFramerate())} FPS <br/> #{totalNumberOfVertices} Total Points <br />" 


	#adds all kind of geometry to geometry-array
	#and adds the shader if is not already set for this geometry-type
	addGeometry: (geometry) ->
		geometries.push geometry
		if geometry.getClassType() is "Mesh"
				meshProgramObject ?= engine.createShaderProgram geometry.vertexShader, geometry.fragmentShader
		if geometry.getClassType() is "Pointcloud"
				pointcloudProgramObject ?= engine.createShaderProgram geometry.vertexShader, geometry.fragmentShader


	#redirects the call from Geometry-Factory directly to engine
	createArrayBufferObject : (data) ->
		engine.createArrayBufferObject data
		
	#redirects the call from Geometry-Factory directly to engine
	createElementArrayBufferObject : (data) ->
		engine.createElementArrayBufferObject data

	#Apply a single draw (not used right now)
	draw : ->
		engine.draw()

# #####################
# MOUSE (not used)
# #####################

	mouseMoved = (evt) ->
		mouseX = evt.pageX
		mouseY = evt.pageY

	mousePressed = ->
		curCoords[0] = mouseX
		curCoords[1] = mouseY
		buttonDown = true

	mouseReleased = ->
		buttonDown = false 

# #####################
# KEYBOARD
# #####################

	makeMovement = () ->

		#Up
		if keyboard.isKeyDown(KEY_W)
			cam.move [0,moveValueStrafe,0]

		#Down
		if keyboard.isKeyDown(KEY_S)
			cam.move [0,-moveValueStrafe,0]
	
		#Right
		if keyboard.isKeyDown(KEY_D)
			cam.move [-moveValueStrafe,0,0]

		#Left
		if keyboard.isKeyDown(KEY_A)
			cam.move [moveValueStrafe,0,0]

		#Forward
		if keyboard.isKeyDown(KEY_Q)
			cam.move [0,0,moveValueStrafe]

		#Backward
		if keyboard.isKeyDown(KEY_Y)
			cam.move [0,0,-moveValueStrafe]

		#Rotate up
		if keyboard.isKeyDown(KEY_UP)
			cam.pitch moveValueRotate

		#Rotate down
		if keyboard.isKeyDown(KEY_DOWN)
			cam.pitch -moveValueRotate

		#Rotate right
		if keyboard.isKeyDown(KEY_RIGHT)
			cam.yaw -moveValueRotate

		#Rotate left
		if keyboard.isKeyDown(KEY_LEFT)
			cam.yaw moveValueRotate

		#Rotate right
		if keyboard.isKeyDown(KEY_E)
			cam.roll -moveValueRotate

		#Rotate left
		if keyboard.isKeyDown(KEY_C)
			cam.roll moveValueRotate


	keyDown = (evt) ->
		keyboard.setKeyDown evt.keyCode

	keyPressed = (evt) ->

	keyUp = (evt) ->
		keyboard.setKeyUp evt.keyCode

# #####################
# HELPER
# #####################

	attach = (element, type, func) ->
		if element.addEventListener
			element.addEventListener type, func, false
		else
			element.attachEvent "on" + type, fn

View = new _View
