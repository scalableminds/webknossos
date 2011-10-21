# GLOBAL VARIABLES
ps = undefined
pointcloud = undefined
cam = undefined
mouseDown = false

# MOUSE EVENTS
mousePressed = ->
	mouseDown = true
	
mouseReleased = ->
	mouseDown = false
	
# #####################
# MAIN RENDER FUNCTION
# #####################
render = ->

	# MOUSE/CAMERA MOVEMENT
	y = -(ps.mouseX - ps.width / 2) / ps.width / 50
	cam.yaw y
	if mouseDown 
		cam.pos = V3.add cam.pos, V3.scale(cam.dir, 0.1)
	
	h = -(ps.mouseY - ps.height / 2) / ps.height / 10
	cam.pos = V3.add cam.pos, [0, h, 0]
  
	ps.loadMatrix M4x4.makeLookAt cam.pos, V3.add(cam.dir, cam.pos), cam.up
	
	ps.println cam.pos
	
	#ps.translate -c[0], -c[1], -c[2]
	#ps.println c
	
	#ps.translate -50, -50, 20
	
	# Render the Pointcloud
	ps.clear()
	ps.render pointcloud
		
	# OUTPUT FPS
	status = document.getElementById('Status')
	status.innerHTML = Math.floor(ps.frameRate) + " FPS"
	
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
	
	# axis = ps.load "Pointstream/clouds/axis.asc"
	pointcloud = read_binary_file()  #ps.load "Pointstream/clouds/lion.psi" 
	return