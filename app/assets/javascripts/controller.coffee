class _Controller
	
	#global variables for camera/plane 
	position = null
	direction = null

	initialize : () ->
		Model.Route.initialize((err, pos, dir) =>
			unless err
				position = pos
				direction = dir
				GeometryFactory.createTrianglesplane(128, 0, "trianglesplane")
				GeometryFactory.createTrianglesplane(128, 1, "trianglesplane")
			else
				throw err
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

  # mouse events
  
  # keyboard events

Controller = new _Controller

start = ->
	Controller.initialize()

