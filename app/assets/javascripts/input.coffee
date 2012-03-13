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

		class Input.Mouse
			
			mouse : null

			constructor : (objectToTrack, bindings) ->
				@mouse = new MouseLib objectToTrack

				for own axis, callback of bindings
					@attach(axis, callback)

			attach : (axis, callback) ->
				@mouse.bindX callback if axis is "x"
				@mouse.bindY callback if axis is "y"
				
		class Input.Deviceorientation

			THRESHOLD = 10
			
			keyPressedCallbacks : {}
			keyBindings : {}
			keyPressedCount : 0

			delay : 300

			constructor : (bindings) ->

				for own key, callback of bindings
					@attach(key, callback)

				$(window).on(
					"deviceorientation", 
					({originalEvent : event}) => 
						if event.gamma < -THRESHOLD
							@fire("left")
							@unfire("right")
						else if event.gamma > THRESHOLD
							@fire("right")
							@unfire("left")
						else
							@unfire("right")
							@unfire("left")

						if event.beta < -THRESHOLD
							@fire("up")
							@unfire("down")
						else if event.beta > THRESHOLD
							@fire("down")
							@unfire("up")
						else
							@unfire("up")
							@unfire("down")
				)

			attach : (key, callback) ->

				@keyBindings[key] = callback

			fire : (key) ->

				unless @keyPressedCallbacks[key]?
					@keyPressedCount++ 
					@keyPressedCallbacks[key] = @keyBindings[key]
					@buttonLoop() if @keyPressedCount == 1


			unfire : (key) ->

				if @keyPressedCallbacks[key]
					@keyPressedCount--
					delete @keyPressedCallbacks[key]
				return

			buttonLoop : ->
				if @keyPressedCount > 0
					for own key, callback of @keyPressedCallbacks
						callback?()

					setTimeout( (=> @buttonLoop()), @delay ) 


		class Input.Gamepad

			# http://robhawkes.github.com/gamepad-demo/
			# https://github.com/jbuck/input.js/
			# http://www.gamepadjs.com/

		Input
)