# GLOBAL VARIABLES
ps = undefined
pointcloud = undefined
mesh = undefined
cam = undefined
mouseDown = false
clipping_distance = 15.0

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
	
	# CLIPPING
	length_dir = Math.sqrt cam.dir[0]*cam.dir[0] + cam.dir[1]*cam.dir[1] +  cam.dir[2]*cam.dir[2]
	
	n0 = [ cam.dir[0] / length_dir, cam.dir[1] / length_dir, cam.dir[2] / length_dir]
	
	versch = [clipping_distance * n0[0], clipping_distance * n0[1], clipping_distance * n0[2]]
	p = V3.add(cam.pos, versch)
	d = V3.dot( p, n0)

	
	ps.uniformf "d",d
	ps.uniformf "n0",n0
	
	# Render the Pointcloud
	ps.clear()
	ps.render pointcloud
	
	ps.translate p[0], p[1], p[2]
	ps.renderMesh mesh
		
	# OUTPUT FPS
	status = document.getElementById('status')
	status.innerHTML = "#{Math.floor(ps.frameRate)} FPS <br/> #{pointcloud.numPoints} Points <br />#{cam.pos}" 
	
	# OUTPUT CAMERA POSITION
	# cameraPos = document.getElementById('camera')
	# cameraPos.innerHTML = cam.pos
	
	return

	
# START SCRIPT		
start = ->		
	cam = new FreeCam()
	cam.pos = [6,5,-15]
	
	ps = new PointStream()
	ps.setup document.getElementById('render'),{"antialias":true}
	
	# LOAD A CUSTOM SHADER
	###
	vert = ps.getShaderStr("js/libs/pointstream/shaders/clip.vs")
	frag = ps.getShaderStr("js/libs/pointstream/shaders/clip.fs")
	progObj = ps.createProgram(vert, frag);
	ps.useProgram(progObj);
	###
	ps.perspective 60, ps.width / ps.height, 15, 20
	ps.background [0.9, 0.9 ,0.9 ,1]
	ps.pointSize 5
	
	ps.onRender = render
	ps.onMousePressed = mousePressed
	ps.onMouseReleased = mouseReleased
	ps.onKeyDown = keyDown
	
	pointcloud = read_binary_file()  	
	mesh = load_obj_file()
	
	return
	
#  SET CAMERA TO NEW POSITON
setCamPosition = ->
	x = parseFloat document.getElementById('camX').value
	y = parseFloat document.getElementById('camY').value
	z = parseFloat document.getElementById('camZ').value
	
	if !isNaN(x) and !isNaN(y) and !isNaN(z)
		cam.pos = [x,y,z]
		return
		
changePerspectiveParams = ->
	near = parseFloat document.getElementById('near').value
	far = parseFloat document.getElementById('far').value
	fovy = parseFloat document.getElementById('fovy').value
	
	if !isNaN(near) and !isNaN(far) and !isNaN(fovy)
		ps.perspective fovy, ps.width / ps.height, near, far
		return	