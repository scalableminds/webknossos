class _View

	# global scene objects
	engine = undefined
	cam = undefined
	cvs = undefined
	keyboard = null

	# geometry objects
	triangleplane = null
	meshes = []

	#ProgramObjects
	#One Shader for each Geometry-Type
	trianglesplaneProgramObject = null
	meshProgramObject = null

	#mouse (not used)
	buttonDown = false
	lastx = 0
	lasty = 0
	mouseX = 0
	mouseY = 0
	rot = [0, 0]
	curCoords = [0, 0]

	#constants
	clippingDistance = 140
	#camPos = [63.5,63.5,-clippingDistance+63.5]
	camPos = [0,0,-clippingDistance]
	moveValueStrafe = 1
	moveValueRotate = 0.02

	perspectiveMatrix = null


	constructor : -> 
		cvs = document.getElementById('render')
		engine = new GL_engine cvs, antialias : true

		cam = new Flycam()
		perspectiveMatrix = cam.getMovedNonPersistent camPos

		engine.background [0.9, 0.9 ,0.9 ,1]
		engine.pointSize 100
		####
		### ACHTUNG VON 60 AUF 90 GEÄNDERT! ###
		#####
		engine.perspective 90, cvs.width / cvs.height, 0.0001, 100000

		engine.onRender = renderFunction

		keyboard = new Keyboard
		keyboard.onChange = keyboardAfterChanged

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
		engine.loadMatrix (M4x4.makeLookAt [ perspectiveMatrix[12], perspectiveMatrix[13], perspectiveMatrix[14] ],
			V3.add([ perspectiveMatrix[8], perspectiveMatrix[9], perspectiveMatrix[10] ], 
				[ perspectiveMatrix[12], perspectiveMatrix[13], perspectiveMatrix[14] ]),
			[ perspectiveMatrix[4], perspectiveMatrix[5], perspectiveMatrix[6] ])
		engine.clear()

		#renders all geometries in geometry-array
		totalNumberOfVertices = 0
		totalNumberOfVertices += drawTriangleplane()

		# first Mesh is always the coordinate axis mini-map
		if meshes[0]
			engine.pushMatrix()
			engine.translate 200,100,0
			# console.log V3.angle [0,0,1], cam.getDir()

			# rotate the axis mini-map according to the cube's rotation and translate it
			rotMatrix = cam.getMatrix()
			rotMatrix[12] = -200
			rotMatrix[13] = 0
			rotMatrix[14] = -75

			engine.loadMatrix rotMatrix

			engine.useProgram meshProgramObject
			engine.render meshes[0]
			engine.popMatrix()

			totalNumberOfVertices += meshes[0].vertices.length

		# OUTPUT Framerate
		writeFramerate Math.floor(engine.framerate), cam.getPos()


	drawTriangleplane = ->
		
		g = triangleplane
		if g.getClassType() is "Trianglesplane"
			# console.log "cam: " + cam.toString()

			transMatrix = cam.getMatrix()
			#console.log "normal: " + g.normalVertices[0] + " " + g.normalVertices[1] + " " + g.normalVertices[2] + 
			#												g.normalVertices[128*128*3-3] + " " + g.normalVertices[128*128*3-2] + " " + g.normalVertices[128*128*3-1]
			newVertices = M4x4.transformPointsAffine transMatrix, g.normalVertices
			#console.log "new: " + newVertices[0] + " " + newVertices[1] + " " + newVertices[2] + 
			#												newVertices[128*128*3-3] + " " + newVertices[128*128*3-2] + " " + newVertices[128*128*3-1]

			#hsa to be removed later
			engine.deleteSingleBuffer g.vertices.VBO
			g.setVertices (View.createArrayBufferObject g.normalVertices), g.normalVertices.length

			#sends current position to Model for preloading data
			deferredUpdate = -> renderFunction()
			Model.Binary.ping(transMatrix)?.done(deferredUpdate).progress(deferredUpdate)


			#sends current position to Model for caching route
			Model.Route.put cam.getPos(), null

			#get colors for new coords from Model
			Model.Binary.get(newVertices).done ({bufferFront, bufferBack, bufferOffset}) ->
				
				engine.deleteSingleBuffer g.interpolationFront.VBO
				engine.deleteSingleBuffer g.interpolationBack.VBO
				engine.deleteSingleBuffer g.interpolationOffset.VBO
				
				g.setInterpolationFront  (View.createArrayBufferObject bufferFront),  bufferFront.length
				g.setInterpolationBack   (View.createArrayBufferObject bufferBack),   bufferBack.length
				g.setInterpolationOffset (View.createArrayBufferObject bufferOffset), bufferOffset.length

			engine.useProgram trianglesplaneProgramObject 
			engine.render g

			#used for total Vertex counting
			return g.vertices.length
			
				

	writeFramerate = (framerate = 0, position = 0) ->	
		document.getElementById('status')
			.innerHTML = "#{framerate} FPS <br/> #{position}<br />" 

	#adds all kind of geometry to geometry-array
	#and adds the shader if is not already set for this geometry-type
	addGeometry : (geometry) ->

		if geometry.getClassType() is "Trianglesplane"
			trianglesplaneProgramObject ?= engine.createShaderProgram geometry.vertexShader, geometry.fragmentShader
			triangleplane = geometry
			#a single draw to see when the triangleplane is ready
			@draw()

		if geometry.getClassType() is "Mesh"
			meshProgramObject ?= engine.createShaderProgram geometry.vertexShader, geometry.fragmentShader
			meshes.push geometry
			@draw()

	addColors : (newColors, x, y, z) ->
		#arrayPosition = x + y*colorWidth + z*colorWidth*colorWidth #wrong
		setColorclouds[0] = 1
		colorclouds[0] = newColors

	#redirects the call from Geometry-Factory directly to engine
	createArrayBufferObject : (data) ->
		engine.createArrayBufferObject data
		
	#redirects the call from Geometry-Factory directly to engine
	createElementArrayBufferObject : (data) ->
		engine.createElementArrayBufferObject data

	#Apply a single draw (not used right now)
	draw : ->
		engine.draw()

	setCam : (position, direction) ->
		cam.setPos position
		cam.setDir direction

		

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

	keyboardAfterChanged = (countKeysDown) ->
		if countKeysDown > 0
			engine.startAnimationLoop()
		else
			engine.stopAnimationLoop()
			window.setTimeout writeFramerate, 500

# #####################
# HELPER
# #####################

	attach = (element, type, func) ->
		if element.addEventListener
			element.addEventListener type, func, false
		else
			element.attachEvent "on" + type, fn

View = new _View
