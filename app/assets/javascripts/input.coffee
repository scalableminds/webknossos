define( [
		"libs/keyboard.0.2.2.min",
		"libs/mouse",
		"libs/gamepad"
	]
	(KeyboardJS, MouseLib, GamepadJS) ->

		Input ?= {}

		class Input.Keyboard

			delay : 1000/30
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
							@buttonLoop()

						return
					=>
						@keyPressedCount--
						delete @keyCallbackMap[key]
						return
				)

			buttonLoop : ->
				if @keyPressedCount > 0
					for key, callback of @keyCallbackMap
						callback()

					setTimeout( (=> @buttonLoop()), @delay ) 

		class Input.Mouse
			
			mouse : null

			constructor : (objectToTrack, bindings) ->
				@mouse = new MouseLib objectToTrack

				for own axis, callback of bindings
					@attach(axis, callback)

			attach : (axis, callback) ->
				if @mouse?
					@mouse.bindX callback if axis is "x"
					@mouse.bindY callback if axis is "y"
				else
					console.log "no mouse is set"


		class Input.Gamepad

			# http://robhawkes.github.com/gamepad-demo/
			# https://github.com/jbuck/input.js/
			# http://www.gamepadjs.com/

			gamepad : null
			delay : 1000 / 30
			buttonCallbackMap : {}
			buttonNameMap :
				"ButtonA" : "faceButton0"
				"ButtonB" : "faceButton1"
				"ButtonX" : "faceButton2"
				"ButtonY" : "faceButton3"
				"ButtonStart"  : "start"
				"ButtonSelect" : "select"

				"LeftStickX" : "leftStickX"
				"LeftStickY" : "leftStickY"
				"RightStickX": "rightStickX"
				"RightStickX": "rightStickY"


			constructor : (bindings) ->
				if GamepadJS.supported

					for own key, callback of bindings
						@attach( @buttonNameMap[key] , callback )

				else
				 console.log "Your browser does not support gamepads!"

			attach : (button, callback)  ->
				@buttonCallbackMap[button] = callback
				@gamepadLoop()

			gamepadLoop : ->
				_pad = GamepadJS.getStates()
				@gamepad = _pad[0]

				if @gamepad?
					for button, callback of @buttonCallbackMap
						unless @gamepad[button] == 0
							callback()

				setTimeout( (=> @gamepadLoop()), @delay)

		Input
)