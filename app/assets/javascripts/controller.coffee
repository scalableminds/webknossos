class _Controller
	
	#global variables for camera/plane 
	position = null
	direction = null

	initialize : () ->
		Model.Route.initialize((err, pos, dir) =>
			unless err
				position = pos
				direction = dir
				@loadPointcloud()
		)

	loadPointcloud : () ->
		GeometryFactory.loadPointcloud position, direction,"pointcloud"

	updatePosition : (pos) ->
		position = pos
		Model.Route.put(position, (err) =>
			console.log err
		)
		# bei jeder Änderung versuchen Pointcloud nachzuladen?
		#@loadPointcloud()

	#move to factory
	createTriangles = (width) ->

		# *6 because two triangles per point and 3 vertices per triangle
		trianglesArraySize = (width)*(width)*6

		triangles = new Uint16Array(trianglesArraySize)
		currentPoint = 0
		currentIndex = 0

		#iterate through all points
		for y in [0..width - 1]
			for x in [0..width - 1]
				# < width -1: because you don't draw a triangle with
				# the last points on each axis.
				if y < (width - 1) and x < (width - 1)
					triangles[currentIndex + 0] = currentPoint
					triangles[currentIndex + 1] = currentPoint + 1 
					triangles[currentIndex + 2] = currentPoint + width
					triangles[currentIndex + 3] = currentPoint + width
					triangles[currentIndex + 4] = currentPoint + width + 1
					triangles[currentIndex + 5] = currentPoint + 1
				currentPoint++
				currentIndex += 6

		return triangles
  # mouse events
  
  # keyboard events

Controller = new _Controller

start = ->
	Controller.initialize()

