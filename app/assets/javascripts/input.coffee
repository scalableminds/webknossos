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
			SLOWDOWN_FACTOR = 250
			
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
						
						{ gamma, beta } = event
						if gamma < -THRESHOLD or gamma > THRESHOLD
							@fire("x", gamma)
						else
							@unfire("x")

						if beta < -THRESHOLD or beta > THRESHOLD
							@fire("y", beta)
						else
							@unfire("y")
				)

			attach : (key, callback) ->

				@keyBindings[key] = callback

			fire : (key, dist) ->

				unless @keyPressedCallbacks[key]?
					@keyPressedCount++ 
					@keyPressedCallbacks[key] = 
						callback : @keyBindings[key]
						distance : dist / SLOWDOWN_FACTOR
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

		Input
)