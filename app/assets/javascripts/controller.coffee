### define
"model" : Model
"view" : View
"geometry_factory" : GeometryFactory
"input" : Input
"helper" : Helper
###

moveValue = 1
rotateValue = 0.01
scaleValue = 0.05

Controller = 

	initialize : (@canvas) ->
		
		@initMouse() 
		@initKeyboard()
		@initGamepad()
		@initDeviceOrientation()

		Model.Route.initialize().then(
			(matrix) =>
					
				View.setMatrix(matrix)

				GeometryFactory.createMesh("coordinateAxes", "mesh").done (mesh) ->
					mesh.relativePosition.x = 100
					View.addGeometry mesh
					
				GeometryFactory.createMesh("crosshair", "mesh_noLight").done (mesh) -> 	
					View.addGeometry mesh

				GeometryFactory.createTrianglesplane(128, 0, "trianglesplane").done (trianglesplane) ->
					View.addGeometry trianglesplane
			
			->
				alert("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
		)

	initMouse : ->
		@input.mouse = new Input.Mouse(
			@canvas
			"x" : View.yawDistance
			"y" : View.pitchDistance
		)

	initKeyboard : ->
		
		@input.keyboard = new Input.Keyboard(

			#Fullscreen Mode
			"f" : => 
				canvas = @canvas
				requestFullscreen = canvas.webkitRequestFullScreen or canvas.mozRequestFullScreen or canvas.RequestFullScreen
				if requestFullscreen
					requestFullscreen.call(canvas, canvas.ALLOW_KEYBOARD_INPUT)

		
			#ScaleTrianglesPlane
			"l" : -> View.scaleTrianglesPlane -scaleValue
			"k" : -> View.scaleTrianglesPlane scaleValue

			#Move
			"w" : -> View.move [0, moveValue, 0]
			"s" : -> View.move [0, -moveValue, 0]
			"a" : -> View.move [moveValue, 0, 0]
			"d" : -> View.move [-moveValue, 0, 0]
			"space" : -> View.move [0, 0, moveValue]
			"shift + space" : -> View.move [0, 0, -moveValue]

			#Rotate in distance
			"left"  : -> View.yawDistance rotateValue
			"right" : -> View.yawDistance -rotateValue
			"up"    : -> View.pitchDistance -rotateValue
			"down"  : -> View.pitchDistance rotateValue
			
			#Rotate at centre
			"shift + left"  : -> View.yaw rotateValue
			"shift + right" : -> View.yaw -rotateValue
			"shift + up"    : -> View.pitch -rotateValue
			"shift + down"  : -> View.pitch rotateValue

			#misc keys
			"n" : -> Helper.toggle()
		)
		
		new Input.KeyboardNoLoop(
			#Branches
			"b" : -> Model.Route.putBranch(View.getMatrix())
			"h" : -> Model.Route.popBranch().done((matrix) -> View.setMatrix(matrix))

			#Zoom in/out
			"o" : -> View.zoomIn()
			"p" : -> View.zoomOut()
		)

	# for more buttons look at Input.Gamepad
	initGamepad : ->
		@input.gamepad = new Input.Gamepad(
				"ButtonA" : -> View.move [0, 0, moveValue]
				"ButtonB" : -> View.move [0, 0, -moveValue]
				"LeftStickX" : View.yawDistance
				"LeftStickY" : View.pitchDistance


		)

	initDeviceOrientation : ->
		@input.deviceorientation = new Input.Deviceorientation(
			"x"  : View.yawDistance
			"y" : View.pitchDistance
		)

	initDeviceOrientation : ->
		@input.deviceorientation = new Input.Deviceorientation(
			"x"  : View.yawDistance
			"y" : View.pitchDistance
		)

	input :
		mouse : null
		keyboard : null
		gamepad : null
		deviceorientation : null

	#Customize Options
	setMoveValue : (value) ->
		moveValue = value

	setRotateValue : (value) ->
		rotateValue = value				

	setScaleValue : (value) ->
		scaleValue = value				

	setMouseRotateValue : (value) ->
		@input.mouse.setRotateValue value if @input.mouse?

	setMouseInversionX : (value) ->
		@input.mouse.setInversionX value if @input.mouse?

	setMouseInversionY : (value) ->
		@input.mouse.setInversionY value if @input.mouse?


	setMouseActivity : (value) ->
		if value is false
			@input.mouse.unbind()
			@input.mouse = null
		else
			@initMouse()

	setKeyboardActivity : (value) ->
		if value is false
			@input.keyboard.unbind()
			@input.keyboard = null
		else
			@initKeyboard()

	setGamepadActivity : (value) ->
		if value is false
			@input.gamepad.unbind()
			@input.gamepad = null
		else
			@initGamepad()		

	setDeviceOrientationActivity : (value) ->
		if value is false
			@input.deviceorientation.unbind()
			@input.deviceorientation = null
		else
			@initDeviceOrientation()					

