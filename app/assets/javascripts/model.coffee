Model ?= {}
Model.Binary =

	coordinatesModel : null
	
	initialize : (callback) ->
		
		@startInitializing callback

		request
			url : '/binary/model/cube'
			responseType : 'arraybuffer'
			,
			(err, data) =>
				
				callback = @endInitializing err
				
				unless err
					@coordinatesModel = new Int8Array(data)
					callback null
				
				return

	rotateAndMove : (data, moveVector, axis, callback) ->
		
		@lazyInitialize (err) ->

			return callback(err) if err

			# orthogonal vector to (0,1,0) and rotation vector
			ortho = Math.normalizeVector([axis[2], 0, -axis[0]])
			# dot product of (0,1,0) and rotation
			dotProd = axis[1]
			
			# transformation of dot product for cosA
			cosA = dotProd / Math.sqrt(Math.square(axis[0]) + Math.square(axis[1]) + Math.square(axis[2]))
			sinA = Math.sqrt(1 - Math.square(cosA))
			
			# calculate rotation matrix
			a00 = cosA + Math.square(ortho[0]) * (1 - cosA)
			a01 = -ortho[2] * sinA
			a02 = ortho[0] * ortho[2] * (1 - cosA)
			
			a10 = ortho[2] * sinA
			a11 = cosA
			a12 = -ortho[0] * sinA
			
			a20 = ortho[0] * ortho[2] * (1 - cosA)
			a21 = ortho[0] * sinA
			a22 = cosA + Math.square(ortho[2]) * (1 - cosA)
			
			# 
			output = new Float32Array(new ArrayBuffer(data.byteLength * 4))
			for i in [0...data.length] by 3
				px = data[i]
				py = data[i + 1]
				pz = data[i + 2]
				
				# see rotation matrix and helmert-transformation for more details
				output[i]     = Math.round(moveVector[0] + (a00 * px + a01 * py + a02 * pz))
				output[i + 1] = Math.round(moveVector[1] + (a10 * px + a11 * py + a12 * pz))
				output[i + 2] = Math.round(moveVector[2] + (a20 * px + a21 * py + a22 * pz))
			
			# clear stack before returning callback
			Utils.defer -> callback(null, output)
	
	get : (position, direction, callback) ->
		@load(position, direction, (err, colors) =>
			if err
				callback(err)
			else
				@rotateAndMove(@coordinatesModel, position, direction, (err, coords) ->
					if err
						callback(err)
					else
						callback(null, coords, colors)
				)
		)

	load : (point, direction, callback) ->
		@lazyInitialize (err) ->
			return callback(err) if err

			request
				url : "/binary/data/cube?px=#{point[0]}&py=#{point[1]}&pz=#{point[2]}&ax=#{direction[0]}&ay=#{direction[1]}&az=#{direction[2]}"
				responseType : 'arraybuffer'
				,
				(err, data) ->
					if err
						callback err
					else
						callback null, new Uint8Array(data) 

Model.Mesh =
	
	get : (name, callback) ->

		request 
			url : "/assets/mesh/#{name}"
			responseType : 'arraybuffer'
			, 
			(err, data) ->

				if err
					callback err 

				else
					try
						header  = new Uint32Array(data, 0, 3)
						coords  = new Float32Array(data, 12, header[0])
						colors  = new Float32Array(data, 12 + header[0] * 4, header[1])
						indexes = new Uint32Array(data, 12 + 4 * (header[0] + header[1]), header[2])

						callback(null, coords, colors, indexes)
					catch ex
						callback(ex)

		
Model.Shader =
	
	get : (name, callback) ->
		request
			url : "/assets/shader/#{name}"
			,
			callback
	
Model.Route =
	
	dirtyBuffer : null
	route : null
	startDirection : null
	id : null

	initialize : (callback) ->

		@startInitializing()

		request
			url : '/route/initialize'
			,
			(err, data) =>
				
				callback = @endInitializing err
				
				unless err
					try
						data = JSON.parse data

						@route = [ data.position ]
						@id = data.id
						@startDirection = data.direction
						
						callback null, data.position, data.direction
					catch ex
						callback ex
	
	push : () ->
		
		request
			url : "/route/#{@id}"
			contentType : 'application/json'
			data : @dirtyBuffer
			,
			(err) ->
				# blablabla
	
	put : (position, callback) ->
		
		@lazyInitialize (err) =>
			return callback(err) if err

			@route.push position
			@dirtyBuffer = [] unless @dirtyBuffer
			@dirtyBuffer.push position


Model.LazyInitializable =
	
	initialized : false

	lazyInitialize : (callback) ->
		unless @initialized
			if @waitingForInitializing
				@waitingForInitializing.push callback
			else
				@initialize callback
		else
			callback null
	
	startInitializing : (callback) ->
		@waitingForInitializing = [ callback ]
	
	endInitializing : (err) ->
		callbacks = @waitingForInitializing
		delete @waitingForInitializing
		
		callback = (args...)->
			cb(args...) for cb in callbacks
			return

		if err
			callback err
			return
		else
			return callback

_.extend Model.Route, Model.LazyInitializable
_.extend Model.Binary, Model.LazyInitializable
