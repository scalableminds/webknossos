define( [
		"libs/keyboard.0.2.2.min",
		"libs/mouse"
	]
	(KeyboardJS, MouseLib) ->

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

		Input
)