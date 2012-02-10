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
				GeometryFactory.createMesh("coordinateAxes", "mesh").then (mesh) ->
					View.addGeometry mesh
					
				GeometryFactory.createMesh("crosshair", "mesh").then (mesh) -> 
					View.addGeometry mesh

				GeometryFactory.createTrianglesplane(128, 0, "trianglesplane").then (trianglesplane) ->
					View.addGeometry trianglesplane		
			else
				throw err
		)

  # mouse events
  
  # keyboard events

Controller = new _Controller

start = ->
	Controller.initialize()

