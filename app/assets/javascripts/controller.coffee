define(
	[
		"model",
		"view",
		"geometry_factory",
		"input",
		"mouse"
	],
	(Model, View, GeometryFactory, Input, Mouse) ->

		Controller ?= {}

		MOVE_VALUE = 1
		ROTATE_VALUE = 0.02
		SCALE_FACTOR = 0.05

		mouse = null
		cvs = null

		initMouse = ->
			Input.Mouse.init cvs
			Input.Mouse.attach "x", View.yawDistance
			Input.Mouse.attach "y", View.pitchDistance

		initKeyboard = ->
			#ScaleTrianglesPlane
			Input.Keyboard.attach "l", -> View.scaleTrianglesPlane(-SCALE_FACTOR)	
			Input.Keyboard.attach "k", -> View.scaleTrianglesPlane(SCALE_FACTOR)	

			#Move
			Input.Keyboard.attach "w", -> View.move [0, MOVE_VALUE, 0]
			Input.Keyboard.attach "s", -> View.move [0, -MOVE_VALUE, 0]
			Input.Keyboard.attach "a", -> View.move [MOVE_VALUE, 0, 0]
			Input.Keyboard.attach "d", -> View.move [-MOVE_VALUE, 0, 0]
			Input.Keyboard.attach "space", -> View.move [0, 0, MOVE_VALUE]
			Input.Keyboard.attach "shift + space", -> View.move [0, 0, -MOVE_VALUE]

			#Rotate in distance
			Input.Keyboard.attach "left", -> View.yawDistance ROTATE_VALUE
			Input.Keyboard.attach "right", -> View.yawDistance -ROTATE_VALUE
			Input.Keyboard.attach "up", -> View.pitchDistance -ROTATE_VALUE
			Input.Keyboard.attach "down", -> View.pitchDistance ROTATE_VALUE

			#Rotate at centre
			Input.Keyboard.attach "shift + left", -> View.yaw ROTATE_VALUE
			Input.Keyboard.attach "shift + right", -> View.yaw -ROTATE_VALUE
			Input.Keyboard.attach "shift + up", -> View.pitch -ROTATE_VALUE
			Input.Keyboard.attach "shift + down", -> View.pitch ROTATE_VALUE

		
		Controller = 
			initialize : (canvas) ->
				cvs = canvas
				initMouse()
				initKeyboard()
				
				Model.Route.initialize().done (matrix) =>
						
					View.setCam(matrix)

					GeometryFactory.createMesh("coordinateAxes", "mesh").done (mesh) ->
						mesh.relativePosition.x = 100
						View.addGeometry mesh
						
					GeometryFactory.createMesh("crosshair", "mesh").done (mesh) -> 	
						View.addGeometry mesh

					GeometryFactory.createTrianglesplane(128, 0, "trianglesplane").done (trianglesplane) ->
						View.addGeometry trianglesplane		

)		

