define(
	[
		"model",
		"view",
		"geometry_factory",
		"input",
		"cube_helper"
	],
	(Model, View, GeometryFactory, Input, CubeHelper) ->

		Controller ?= {}

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
							
						GeometryFactory.createMesh("crosshair", "mesh").done (mesh) -> 	
							View.addGeometry mesh

						GeometryFactory.createTrianglesplane(128, 0, "trianglesplane").done (trianglesplane) ->
							View.addGeometry trianglesplane
					
						CubeHelper.initialize()


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
				)
				
				new Input.KeyboardNoLoop(
					#Branches
					"b" : -> Model.Route.putBranch(View.getMatrix())
					"h" : -> Model.Route.popBranch().done((matrix) -> View.setMatrix(matrix))
				)

			initGamepad : ->
				@input.gamepad = new Input.Gamepad(
						"ButtonA" : -> console.log "A"
						"ButtonB" : -> console.log "B"
						"ButtonX" : -> console.log "X"
						"ButtonY" : -> console.log "Y"
						"ButtonStart"  : -> console.log "Start"
						"ButtonSelect" : -> console.log "Select"

						# "LeftStickX" : -> console.log "LeftStick X"
						# "LeftStickY" : -> console.log "LeftStick Y"
						# "RightStickX": -> console.log "RightStick X"
						# "RightStickX": -> console.log "RightStick Y"
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


)
