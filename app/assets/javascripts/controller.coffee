define(
	[
		"model",
		"view",
		"geometry_factory",
		"input"
	]
	(Model, View, GeometryFactory, Input) ->

		Controller =

			initialize : ->
				
				Model.Route.initialize().done (matrix) =>
						
					View.setCam(matrix)

					GeometryFactory.createMesh("coordinateAxes", "mesh").done (mesh) ->
						View.addGeometry mesh
						
					GeometryFactory.createMesh("crosshair", "mesh").done (mesh) -> 
						View.addGeometry mesh

					GeometryFactory.createTrianglesplane(128, 0, "trianglesplane").done (trianglesplane) ->
						View.addGeometry trianglesplane		

				# mouse events
				  
				# keyboard events
				Input.Keyboard.attach "t", -> console.log "t"
)		
