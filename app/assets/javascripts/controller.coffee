Controller =
	
	position : null
	direction : null

	initialize : ->
		
		Model.Route.initialize().done ({ position, direction }) =>
			
			@position  = position
			@direction = direction
			
			View.setCam(position, direction)

			GeometryFactory.createMesh("coordinateAxes", "mesh").done (mesh) ->
				View.addGeometry mesh
				
			GeometryFactory.createMesh("crosshair", "mesh").done (mesh) -> 
				View.addGeometry mesh

			GeometryFactory.createTrianglesplane(128, 0, "trianglesplane").done (trianglesplane) ->
				View.addGeometry trianglesplane		

  # mouse events
  
  # keyboard events


start = ->
	Controller.initialize()

