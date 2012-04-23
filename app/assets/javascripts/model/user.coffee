### define
libs/request : request
###

# This takes care of the userdate. 
User ?= {}


User.Configuration = 

	#default userdata
	moveValue : 1
	rotateValue : 0.01
	scaleValue : 0.05
	mouseRotateValue : 0.004
	mouseInversionX : 1
	mouseInversionY : 1
	mouseActive : true
	keyboardActive : true
	gamepadActive : false
	motionsensorActive : false


	initialize : ->
		unless @configDeferred
			
			@configDeferred = $.Deferred()

			@configDeferred.fail =>
				@configDeferred = null

			request(url : '/user/configuration').then( 
				
				(data) =>
					try
						data = JSON.parse data


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
			data   : { mouseActive : "false", moveValue : "2" }
		).fail( =>
			
			console.log "could'nt save userdata"

		).always(-> deferred.resolve())
		
		deferred.promise()		
