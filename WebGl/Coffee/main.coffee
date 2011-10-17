ps = new PointStream()
ps.setup document.getElementById('render'),{"antialias":true}

pointcloud = ps.load "/BrainFlight/WebGl/Pointstream/clouds/acorn.asc"

# MAIN RENDER FUNCTION
render = ->

	# Render the Pointcloud
	ps.translate 0,0, -25
	ps.clear()
	ps.render pointcloud	
	return
		
ps.pointSize 6
ps.onRender = render