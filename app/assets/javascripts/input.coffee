define( [
		"libs/keyboard.0.2.2.min",
		"libs/mouse",
		"libs/gamepad"
	]
	(KeyboardJS, MouseLib, GamepadJS) ->

		Input ?= {}

		class Input.KeyboardNoLoop

			constructor : (bindings) ->
				for own key, callback of bindings
					@attach(key, callback)

			attach : (key, callback) ->

				KeyboardJS.bind.key(key, callback)

		class Input.Keyboard

			delay : 1000 / 30
			keyCallbackMap : {}
			keyPressedCount : 0

			constructor : (bindings) ->
				for own key, callback of bindings
					@attach(key, callback)

			attach : (key, callback) ->

				KeyboardJS.bind.key(
					key
					=>
						unless @keyCallbackMap[key]?
							@keyPressedCount++ 
							@keyCallbackMap[key] = callback
							@buttonLoop() if @keyPressedCount == 1

						return
					=>
						@keyPressedCount--
						delete @keyCallbackMap[key]
						return
				)

			buttonLoop : ->
				if @keyPressedCount > 0
					for own key, callback of @keyCallbackMap
						callback()

					setTimeout( (=> @buttonLoop()), @delay ) 

			unbind : ->
				KeyboardJS.unbind.key "all"


		class Input.Mouse
			
			mouse : null

			constructor : (objectToTrack, bindings) ->
				@mouse = new MouseLib objectToTrack

				for own axis, callback of bindings
					@attach(axis, callback)

			attach : (axis, callback) ->
				@mouse.bindX callback if axis is "x"
				@mouse.bindY callback if axis is "y"

			setInversionX : (value) ->
				@mouse.setInversionX value if @mouse?

			setInversionY : (value) ->
				@mouse.setInversionY value if @mouse?

			setRotateValue : (value) ->
				@mouse.setRotateValue value if @mouse?

			unbind : ->
				@mouse.unbind()

				
		class Input.Deviceorientation

			THRESHOLD = 10
			SLOWDOWN_FACTOR = 500
			
			keyPressedCallbacks : {}
			keyBindings : {}
			keyPressedCount : 0

			delay : 1000 / 30

			constructor : (bindings) ->

				for own key, callback of bindings
					@attach(key, callback)

				$(window).on(
					"deviceorientation", 
					@eventHandler = ({originalEvent : event}) => 
						
						{ gamma, beta } = event
						if gamma < -THRESHOLD or gamma > THRESHOLD
							@fire("x", -gamma)
						else
							@unfire("x")

						if beta < -THRESHOLD or beta > THRESHOLD
							@fire("y", beta)
						else
							@unfire("y")
				)

			attach : (key, callback) ->

				@keyBindings[key] = callback

			unbind : ->
				$(window).off(
					"deviceorientation", 
					@eventHandler
					@unfire("x")
					@unfire("y")
				)			

			fire : (key, dist) ->

				unless @keyPressedCallbacks[key]?
					@keyPressedCount++ 
					@keyPressedCallbacks[key] = 
						callback : @keyBindings[key]
						distance : (dist - THRESHOLD) / SLOWDOWN_FACTOR
					@buttonLoop() if @keyPressedCount == 1


			unfire : (key) ->

				if @keyPressedCallbacks[key]
					@keyPressedCount--
					delete @keyPressedCallbacks[key]
				return

			buttonLoop : ->
				if @keyPressedCount > 0
					for own key, { callback, distance } of @keyPressedCallbacks
						callback?(distance)

					setTimeout( (=> @buttonLoop()), @delay ) 


		class Input.Gamepad

			# http://robhawkes.github.com/gamepad-demo/
			# https://github.com/jbuck/input.js/
			# http://www.gamepadjs.com/
			
			THRESHOLD = 0.008
			SLOWDOWN_FACTOR = 500

			gamepad : null
			delay :  250
			buttonCallbackMap : {}
			buttonNameMap :
				"ButtonA" : "faceButton0"
				"ButtonB" : "faceButton1"
				"ButtonX" : "faceButton2"
				"ButtonY" : "faceButton3"
				"ButtonStart"  : "start"
				"ButtonSelect" : "select"

				"ButtonLeftTrigger"  : " leftShoulder0"
				"ButtonRightTrigger" : "rightShoulder0"
				"ButtonLeftShoulder" : "leftShoulder1"
				"ButtonRightShoulder": "rightShoulder1"

				"ButtonUp"    : "dpadUp"
				"ButtonDown"  : "dpadDown"
				"ButtonLeft"  : "dpadLeft"
				"ButtonRight" : "dpadRight"

				"ButtonLeftStick"  : "leftStickButton"
				"ButtonRightStick" : "rightStickButton"
				"LeftStickX" : "leftStickX"
				"LeftStickY" : "leftStickY"
				"RightStickX": "rightStickX"
				"RightStickY": "rightStickY"


			constructor : (bindings) ->
				if GamepadJS.supported

					for own key, callback of bindings
						@attach( @buttonNameMap[key] , callback )
					_.defer => @gamepadLoop()

				else
				 console.log "Your browser does not support gamepads!"

			attach : (button, callback)  ->
					@buttonCallbackMap[button] = callback

			unbind : ->
				@buttonCallbackMap = null
				#for own key, callback of @buttonCallbackMap
				#		@attach( @buttonNameMap[key] , null )			


			gamepadLoop : ->
				#stops the loop caused by unbind
				return unless @buttonCallbackMap

				_pad = GamepadJS.getStates()
				@gamepad = _pad[0]

				if @gamepad?
					for button, callback of @buttonCallbackMap
						unless @gamepad[button] == 0
							# axes
							if button in ["leftStickX", "rightStickX", "leftStickY", "rightStickY"]
								value = @gamepad[button]
								callback filterDeadzone(value)

							#buttons
							else
								callback()


				setTimeout( (=> @gamepadLoop()), @delay)

			filterDeadzone : (value) ->
    			Math.abs(value) > 0.35 ? value : 0



		Input
)