# GLOBAL VARIABLES
ps = undefined
pointcloud = undefined
mesh = undefined
cam = undefined
mouseDown = false

# MOUSE/KEYBOARD EVENTS
mousePressed = ->
	mouseDown = true
	
mouseReleased = ->
	mouseDown = false

keyDown = ->
	switch ps.key
		# W --> MOVE FORWARD
		when 119 
			cam.pos = V3.add cam.pos, V3.scale(cam.dir, 0.2) 
			return
		# S --> MOVE BACKWARD
		when 115
			cam.pos = V3.add cam.pos, V3.scale(cam.dir, -0.2)
			return
		# A --> STRAFE LEFT
		when 97
			cam.pos = V3.add cam.pos, V3.scale(cam.left, 0.2)
			return
		# D --> STRAFE RIGHT
		when 100
			cam.pos = V3.add cam.pos, V3.scale(cam.left, -0.2)
			return
	
# #####################
# MAIN RENDER FUNCTION
# #####################
render = ->

	# MOUSE/CAMERA MOVEMENT
	if mouseDown 
		y = -(ps.mouseX - ps.width / 2) / ps.width / 45
		cam.yaw y
	
		h = -(ps.mouseY - ps.height / 2) / ps.height / 8
		cam.pos = V3.add cam.pos, [0, h, 0]
  
	ps.loadMatrix M4x4.makeLookAt cam.pos, V3.add(cam.dir, cam.pos), cam.up
	
	#ps.translate -c[0], -c[1], -c[2]
	#ps.println c
	
	# Render the Pointcloud
	ps.clear()
	ps.render pointcloud
	
	ps.renderMesh mesh
		
	# OUTPUT FPS
	# status = document.getElementById('Status')
	# status.innerHTML = Math.floor(ps.frameRate) + " FPS <br/> " +  pointcloud.numPoints + " Points" 
	
	return

	
# START SCRIPT		
start = ->		
	cam = new FreeCam()
	ps = new PointStream()
	ps.setup document.getElementById('render'),{"antialias":true}
	
	ps.background [0.9, 0.9 ,0.9 ,1]
	ps.pointSize 5
	
	ps.onRender = render
	ps.onMousePressed = mousePressed
	ps.onMouseReleased = mouseReleased
	ps.onKeyDown = keyDown
	
	# axis = ps.load "Pointstream/clouds/axis.asc"
	pointcloud = read_binary_file()  #ps.load "Pointstream/clouds/lion.psi" 
	
	mesh = read_obj_file()
	
	return