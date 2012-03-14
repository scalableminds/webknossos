define ->
	class Mouse

		SLOWDOWN_FACTOR = 250		

		buttonDown : false
		doubleClicked : false
		
		# used for mouse locking in fullscreen mode
		locked : false

		lastPosition : 
			x : null
			y : null

		changedCallback :  
			x : $.noop()
			y : $.noop() 

		###
		#@param {Object} target : DOM Element
		#	HTML object where the mouse attaches the events
		###
		constructor : (@target) ->
		
			navigator.pointer = navigator.webkitPointer or navigator.pointer or navigator.mozPointer

			$(target).on 
				"mouseup" : @mouseUp
				"dblclick" : @mouseDoubleClick

				# fullscreen pointer lock
				# Firefox does not yet support Pointer Lock
				"webkitfullscreenchange" : @toogleMouseLock
				# TODO these two need to be revised, once the API spec is finalized
				"webkitpointerlocklost" : @unlockMouse #???
				"webkitpointerlockchange" : @unlockMouse

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

			# regular mouse management
			unless @locked 
				if @doubleClicked
					distX = -(evt.pageX - lastPosition.x)
					distY =   evt.pageY - lastPosition.y
					changedCallback.x distX / SLOWDOWN_FACTOR if distX isnt 0
					changedCallback.y distY / SLOWDOWN_FACTOR if distY isnt 0

				@lastPosition =
					x : evt.pageX
					y : evt.pageY

			# fullscreen API 
			# Mouse lock returns MovementX/Y in addition to the regular properties
			# (these become static)		
			else
				distX = -evt.originalEvent.webkitMovementX
				distY = evt.originalEvent.webkitMovementY
				changedCallback.x distX / SLOWDOWN_FACTOR if distX isnt 0
				changedCallback.y distY / SLOWDOWN_FACTOR if distY isnt 0

		mouseDoubleClick : =>
			@doubleClicked = !@doubleClicked

		# depricated
		mouseDown : =>
			$(@target).css("cursor", "none")
			@buttonDown = true

		mouseUp : =>
			@buttonDown = false 
			$(@target).css("cursor", "auto")

		toogleMouseLock : =>
			unless @locked
				if (navigator.pointer)
					navigator.pointer.lock @target, ( -> console.log "Mouse Lock successful" ), ( -> console.log "Error: Mouse Lock" )
					@locked = true
			else
				@locked = false
				navigator.pointer.unlock()
