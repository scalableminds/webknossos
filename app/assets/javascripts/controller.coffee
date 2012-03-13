define(
	[
		"model",
		"view",
		"geometry_factory",
		"input"
	],
	(Model, View, GeometryFactory, Input) ->

		Controller ?= {}

		MOVE_VALUE = 1
		ROTATE_VALUE = 0.02
		SCALE_FACTOR = 0.05

		Controller = 

			initialize : (@canvas) ->
				
				@initMouse() 
				@initKeyboard()
				@input.deviceorientation = new Input.Deviceorientation(
					"x"  : View.yawDistance
					"y" : View.pitchDistance
				)
				
				Model.Route.initialize().done (matrix) =>
						
					View.setMatrix(matrix)

					GeometryFactory.createMesh("coordinateAxes", "mesh").done (mesh) ->
						mesh.relativePosition.x = 100
						View.addGeometry mesh
						
					GeometryFactory.createMesh("crosshair", "mesh").done (mesh) -> 	
						View.addGeometry mesh

					GeometryFactory.createTrianglesplane(128, 0, "trianglesplane").done (trianglesplane) ->
						View.addGeometry trianglesplane

			initMouse : ->
				@input.mouse = new Input.Mouse(
					@canvas
					"x" : View.yawDistance
					"y" : View.pitchDistance
				)

			initKeyboard : ->
				
				@input.keyboard = new Input.Keyboard(
				
					#ScaleTrianglesPlane
					"l" : -> View.scaleTrianglesPlane(-SCALE_FACTOR)	
					"k" : -> View.scaleTrianglesPlane(SCALE_FACTOR)	

					#Move
					"w" : -> View.move [0, MOVE_VALUE, 0]
					"s" : -> View.move [0, -MOVE_VALUE, 0]
					"a" : -> View.move [MOVE_VALUE, 0, 0]
					"d" : -> View.move [-MOVE_VALUE, 0, 0]
					"space" : -> View.move [0, 0, MOVE_VALUE]
					"shift + space" : -> View.move [0, 0, -MOVE_VALUE]

					#Rotate in distance
					"left"  : -> View.yawDistance ROTATE_VALUE
					"right" : -> View.yawDistance -ROTATE_VALUE
					"up"    : -> View.pitchDistance -ROTATE_VALUE
					"down"  : -> View.pitchDistance ROTATE_VALUE

					#Branches
					"b" : -> Model.Route.putBranch(View.getMatrix())
					"h" : -> Model.Route.popBranch().done((matrix) -> View.setMatrix(matrix))

					#Rotate at centre
					"shift + left"  : -> View.yaw ROTATE_VALUE
					"shift + right" : -> View.yaw -ROTATE_VALUE
					"shift + up"    : -> View.pitch -ROTATE_VALUE
					"shift + down"  : -> View.pitch ROTATE_VALUE
				)

			input :
				mouse : null
				keyboard : null
				deviceorientation : null

)		

