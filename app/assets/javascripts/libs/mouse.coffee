define ->
	class Mouse

		SLOWDOWN_FACTOR = 250		

		buttonDown : false

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

			if @buttonDown
				distX = -(evt.pageX - lastPosition.x)
				distY =   evt.pageY - lastPosition.y
				changedCallback.x distX/SLOWDOWN_FACTOR if distX isnt 0
				changedCallback.y distY/SLOWDOWN_FACTOR if distY isnt 0

			@lastPosition =
				x : evt.pageX
				y : evt.pageY		

		mouseDown : =>
			$(@target).css("cursor", "none")
			@buttonDown = true

		mouseUp : =>
			@buttonDown = false 
			$(@target).css("cursor", "auto")

		attachEventHandler : (type, func) ->
			if @target.addEventListener
				@target.addEventListener type, func, false
			else
				@target.attachEvent "on" + type, fn