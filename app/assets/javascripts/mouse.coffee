define ->
	class Mouse

		SLOWDOWN_FACTOR = 250		

		buttonDown = null

		lastPosition = {
			x : null,
			y : null
		}

		target = null

		changedCallback = { 
			x : $.noop(),
			y : $.noop() 
		}

		###
		#@param {Object} objectToTrack :
		#	HTML object where the mouse has to attach the events
		###
		constructor : (objectToTrack) ->
			target = objectToTrack
			attach objectToTrack, "mousemove", mouseMoved
			attach objectToTrack, "mouseup", mouseReleased
			attach objectToTrack, "mousedown", mousePressed
			buttonDown = false

		###
		#Binds a function as callback when X-Position was changed
		#@param {Function} callback :
		#	gets a modified distance as parameter
		###
		bindX : (callback) ->
			changedCallback.x = callback

		###
		#Binds a function as callback when Y-Position was changed
		#@param {Function} callback :
		#	gets a modified distance as parameter
		###
		bindY : (callback) ->
			changedCallback.y = callback

		mouseMoved = (evt) ->
			if buttonDown
				distX = evt.pageX - lastPosition.x
				distY = evt.pageY - lastPosition.y
				changedCallback.x distX/SLOWDOWN_FACTOR if distX isnt 0
				changedCallback.y distY/SLOWDOWN_FACTOR if distY isnt 0

			lastPosition.x = evt.pageX
			lastPosition.y = evt.pageY		

		mousePressed = ->
			buttonDown = true

		mouseReleased = ->
			buttonDown = false 

		attach = (element, type, func) ->
			if element.addEventListener
				element.addEventListener type, func, false
			else
				element.attachEvent "on" + type, fn