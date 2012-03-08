define(
	[
		"model",
		"view",
		"geometry_factory",
		"input",
		"mouse"
	],
	(Model, View, GeometryFactory, Input, Mouse) ->

		class _Controller
			
			MOVE_VALUE_STRAFE = 1

			mouse = null
			cvs = null

			initialize : () ->
				cvs = document.getElementById "render"

				@initMouse()
				@initKeyboard()
				
				Model.Route.initialize().done (matrix) =>
						
					View.setCam(matrix)

					GeometryFactory.createMesh("coordinateAxes", "mesh").done (mesh) ->
						View.addGeometry mesh
						
					GeometryFactory.createMesh("crosshair", "mesh").done (mesh) -> 
						View.addGeometry mesh

					GeometryFactory.createTrianglesplane(128, 0, "trianglesplane").done (trianglesplane) ->
						View.addGeometry trianglesplane		

			initMouse : ->
				Input.Mouse.init cvs
				Input.Mouse.attach "x", View.yawDistance
				Input.Mouse.attach "y", View.pitchDistance

			initKeyboard : ->

				Input.Keyboard.attach "t", -> console.log "t"

		Controller = new _Controller 
)		

