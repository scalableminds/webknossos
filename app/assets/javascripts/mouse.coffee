define ->
	class Mouse

		ROTATE_SLOWDOWN = 250		

		buttonDown = null

		lastPosition = {
			x : null,
			y : null
		}

		target = null

		changedCallback = { 
			x : null,
			y : null 
		}

		constructor : (objectToTrack) ->
			target = objectToTrack
			attach objectToTrack, "mousemove", mouseMoved
			attach objectToTrack, "mouseup", mouseReleased
			attach objectToTrack, "mousedown", mousePressed
			buttonDown = false

		bindX : (f) ->
			changedCallback.x = f

		bindY : (f) ->
			changedCallback.y = f

		mouseMoved = (evt) ->
			if buttonDown
				distX = evt.pageX - lastPosition.x
				distY = evt.pageY - lastPosition.y
				changedCallback.x distX/ROTATE_DIVISION if distX isnt 0
				changedCallback.Y distY/ROTATE_DIVISION if distY isnt 0

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