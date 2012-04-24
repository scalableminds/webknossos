### define
libs/request : request
###

# This takes care of the userdate. 
User ?= {}


User.Configuration = 

	# userdata
	# default values are defined by server
	moveValue : null
	rotateValue : null
	scaleValue : null
	mouseRotateValue : null
	mouseInversionX : null
	mouseInversionY : null
	mouseActive : null
	keyboardActive : null
	gamepadActive : null
	motionsensorActive : null


	initialize : ->
		unless @configDeferred
			
			@configDeferred = $.Deferred()

			@configDeferred.fail =>
				@configDeferred = null

			request(url : '/user/configuration').then( 
				
				(data) =>
					try
						data = JSON.parse data
						{ @moveValue, 
							@rotateValue, 
							@scaleValue, 
							@mouseRotateValue, 
							@mouseInversionX,
							@mouseInversionY,
							@mouseActive, 
							@keyboardActive,
							@gamepadActive,
							@motionsensorActive } = data

					catch ex
						@configDeferred.reject(ex)
					
					@configDeferred.resolve(data)

				(err) =>
					@configDeferred.reject(err)
			)
		
			@configDeferred.promise()

	push : ->
		deferred = $.Deferred()
			
		request(
			url    : "/user/configuration"
			method : 'POST'
			contentType : "application/json"
			data   : { 
				moveValue : @moveValue,
				rotateValue : @rotateValue,
				scaleValue : @scaleValue,
				mouseRotateValue : @mouseRotateValue,
				mouseInversionX : @mouseInversionX,
				mouseInversionY : @mouseInversionY,
				mouseActive : @mouseActive,
				keyboardActive : @keyboardActive,
				gamepadActive : @gamepadActive,
				motionsensorActive : @motionsensorActive }
		).fail( =>
			
			console.log "could'nt save userdata"

		).always(-> deferred.resolve())
		
		deferred.promise()		
