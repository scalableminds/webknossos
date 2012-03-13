define ->
	class Mouse

		SLOWDOWN_FACTOR = 250		

		buttonDown : false
		
		# used for mopuse locking in fullscreen mode
		locked : false

		lastPosition : 
			x : null
			y : null

		target : null

		changedCallback :  
			x : $.noop()
			y : $.noop() 

		###
		#@param {Object} objectToTrack :
		#	HTML object where the mouse has to attach the events
		###
		constructor : (objectToTrack) ->
		
			@target = objectToTrack
			@attachEventHandler "mousemove", @mouseMoved
			@attachEventHandler "mouseup", @mouseUp
			@attachEventHandler "mousedown", @mouseDown

			# fullscreen pointer lock 
			@attachEventHandler "webkitfullscreenchange", @lockMouse
			@attachEventHandler "mozfullscreenchange", @lockMouse
		
		###
		#Binds a function as callback when X-Position was changed
		#@param {Function} callback :
		#	gets a modified distance as parameter
		###
		bindX : (callback) ->
			@changedCallback.x = callback

		###
		#Binds a function as callback when Y-Position was changed
		#@param {Function} callback :
		#	gets a modified distance as parameter
		###
		bindY : (callback) ->
			@changedCallback.y = callback

		mouseMoved : (evt) =>
			
			{ lastPosition, changedCallback } = @

			unless @locked 
				if @buttonDown
					distX = -(evt.pageX - lastPosition.x)
					distY =   evt.pageY - lastPosition.y
					changedCallback.x distX/SLOWDOWN_FACTOR if distX isnt 0
					changedCallback.y distY/SLOWDOWN_FACTOR if distY isnt 0

				@lastPosition =
					x : evt.pageX
					y : evt.pageY
			else
				if @buttonDown	
					distX = evt.webkitMovementX
					distY = evt.webkitMovementY
					changedCallback.x distX/SLOWDOWN_FACTOR if distX isnt 0
					changedCallback.y distY/SLOWDOWN_FACTOR if distY isnt 0

		mouseDown : =>
			$(@target).css("cursor", "none")
			@buttonDown = true

		mouseUp : =>
			@buttonDown = false 
			$(@target).css("cursor", "auto")

		lockMouse : =>
			@locked = true
			navigator.webkitpointer.lock @target, -> console.log "Success Mosue Lock", -> console.log "Error: Mouse Lock"

		unlockMouse : =>
			@locked = false

		attachEventHandler : (type, func) ->
			if @target.addEventListener
				@target.addEventListener type, func, false
			else
				@target.attachEvent "on" + type, fn