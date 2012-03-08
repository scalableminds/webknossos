define( [
		"libs/keyboard.0.2.2.min",
		"mouse"
	]
	(KeyboardJS, Mouse) ->

		Input ?= {}

		Input.Keyboard =

			delay : 1000
			keyCallbackMap : {}
			keyPressedCount : 0

			attach : (key, callback) ->

				KeyboardJS.bind.key(
					key
					=>
						console.log "down"
						unless @keyCallbackMap[key]?
							@keyPressedCount++ 
							@keyCallbackMap[key] = callback
							@buttonLoop()

						return
					=>
						console.log "up"
						@keyPressedCount--
						delete @keyCallbackMap[key]
						return
				)

			buttonLoop : ->
				if @keyPressedCount > 0
					for key, callback of @keyCallbackMap
						callback()

					setTimeout( (=> @buttonLoop()), @delay ) 

		Input.Mouse = 
			mouse : null

			init : (objectToTrack) ->
				@mouse = new Mouse objectToTrack

			attach : (axis, callback) ->
				if @mouse?
					@mouse.bindX callback if axis is "x"
					@mouse.bindY callback if axis is "y"
				else
					console.log "no mouse is set"


		Input.Gamepad = $.noop()	

			# http://robhawkes.github.com/gamepad-demo/
			# https://github.com/jbuck/input.js/
			# http://www.gamepadjs.com/

		return Input
)