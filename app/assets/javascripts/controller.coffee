class _Controller
	
	#global variables for camera/plane 
	position = null
	direction = null

	initialize : () ->
		Model.Route.initialize((err, pos, dir) =>
			unless err
				position = pos
				direction = dir
				View.setCam pos, dir
				GeometryFactory.createMesh("coords","mesh")
				GeometryFactory.createTrianglesplane(128, 0, "trianglesplane")
				#GeometryFactory.createTrianglesplane(128, 1, "trianglesplane")
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


  # mouse events
  
  # keyboard events

Controller = new _Controller

start = ->
	Controller.initialize()

