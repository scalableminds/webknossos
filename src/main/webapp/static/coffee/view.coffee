class _View

	engine = undefined
	cam = undefined
	cvs = undefined
	geometries = []

	#ProgObj
	meshProgramObject = null
	pointcloudProgramObject = null


	#mouse
	buttonDown = false
	mouseX = 0
	mouseY = 0
	rot = [0, 0]
	curCoords = [0, 0]

	#constants
	clipping_distance = 2.0
	camPos = [5,6,-15]

	constructor: () -> 
		cvs = document.getElementById('render')
		engine = new GL_engine cvs, {"antialias":true}

		cam = new FreeCam()
		cam.pos = camPos

		engine.background [0.9, 0.9 ,0.9 ,1]
		engine.pointSize 5
		engine.onRender renderFunction

		#Mouse
		attach cvs, "mousemove", mouseMoved
		attach cvs, "mouseup", mouseReleased
		attach cvs, "mousedown", mousePressed

		# LOAD A CUSTOM SHADER







# #####################
# MAIN RENDER FUNCTION
# #####################
	renderFunction = ->
		###
		#engine.perspective 60, engine.getWidth() / engine.getHeight(), 15, 30
		# MOUSE/CAMERA MOVEMENT
		if buttonDown 
			y = -(engine.mouseX - engine.getWidth / 2) / engine.getWidth / 45
			cam.yaw y
	
			h = -(engine.mouseY - engine.getHeight / 2) / engine.getHeight / 8
			cam.pos = V3.add cam.pos, [0, h, 0]
		
		###
		engine.loadMatrix M4x4.makeLookAt cam.pos, V3.add(cam.dir, cam.pos), cam.up
		
		# CLIPPING
		length_dir = Math.sqrt cam.dir[0]*cam.dir[0] + cam.dir[1]*cam.dir[1] +  cam.dir[2]*cam.dir[2]
	
		n0 = [ cam.dir[0] / length_dir, cam.dir[1] / length_dir, cam.dir[2] / length_dir]
	
		versch = [clipping_distance * n0[0], clipping_distance * n0[1], clipping_distance * n0[2]]
		p = V3.add(cam.pos, versch)
		d = V3.dot( p, n0)

	
		engine.uniformf "d",d
		engine.uniformf "n0",n0

		
		if buttonDown
			deltaX = mouseX - curCoords[0]
			deltaY = mouseY - curCoords[1]
			rot[0] += deltaX / cvs.width * 5
			rot[1] += deltaY / cvs.height * 5
			curCoords[0] = mouseX
			curCoords[1] = mouseY

		engine.rotateY rot[1]
		engine.rotateX rot[0]

		#engine.translate p[0], p[1], p[2]
		# Render the Pointcloud
		engine.clear()
		for i in [0...geometries.length] by 1
			engine.useProgram = meshProgramObject if geometries[i].getClassType() is "Mesh"
			engine.useProgram = pointcloudProgramObject if geometries[i].getClassType() is "Pointcloud"
			engine.render geometries[i]
	
		#engine.translate p[0], p[1], p[2]
		#engine.renderMesh mesh
		
		# OUTPUT Feng
		status = document.getElementById('status')
		status.innerHTML = "#{Math.floor(engine.getFramerate())}"
		#status.innerHTML = "#{Math.floor(engine.getFramerate())} Feng <br/> #{pointcloud.vertices.length} Points <br />#{cam.pos}" 
	
		# OUTPUT CAMERA POSITION
		# cameraPos = document.getElementById('camera')
		# cameraPos.innerHTML = cam.pos
	


		return



	
	addGeometry: (geometry) ->
		geometries.push geometry
		if geometry.getClassType() is "Mesh"
				meshProgramObject ?= engine.createShaderProgram geometry.vertexShader, geometry.fragmentShader
		if geometry.getClassType() is "Pointcloud"
				pointcloudProgramObject ?= engine.createShaderProgram geometry.vertexShader, geometry.fragmentShader


	createArrayBufferObject : (data) ->
		engine.createArrayBufferObject data



	#Mouse
	mouseMoved = (evt) ->
		mouseX = evt.pageX
		mouseY = evt.pageY

	mousePressed = ->
		curCoords[0] = mouseX
		curCoords[1] = mouseY
		buttonDown = true

	mouseReleased = ->
		buttonDown = false 

	attach = (element, type, func) ->
		if element.addEventListener
			element.addEventListener type, func, false
		else
			element.attachEvent "on" + type, fn

View = new _View
