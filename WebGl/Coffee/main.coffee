ps = new PointStream()
ps.setup document.getElementById('render'),{"antialias":true}

pointcloud = read_binary_file() #ps.load "/BrainFlight/WebGl/Pointstream/clouds/acorn.asc"

# MAIN RENDER FUNCTION
render = ->

	# Render the Pointcloud
	ps.translate 0,0, -25
	ps.clear()
	ps.render pointcloud	
	return
		
ps.pointSize 10
ps.onRender = render