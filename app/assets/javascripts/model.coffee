Model ?= {}

Model.Binary =

	vertexTemplate : null
	
	initialize : (callback) ->
		
		@startInitializing callback

		request
			url : '/binary/model/cube'
			responseType : 'arraybuffer'
			,	
			(err, data) =>
				
				callback = @endInitializing err
				
				unless err
					@vertexTemplate = new Int8Array(data)
					callback null
				
				return

	rotateAndTranslate : (data, moveVector, axis, callback) ->
		
		output = new Float32Array(data.length)
		axis = V3.normalize axis


		unless axis[0] == 0 and axis[1] == 1 and axis[2] == 0
			
			mat = M4x4.makeRotate V3.angle([0,1,0], axis), [axis[2], 0, -axis[0]]
			mat = M4x4.translateSelf moveVector, mat
		
			_.defer -> callback null, M4x4.transformPointsAffine(mat, data, output)
		
		else

			[px, py, pz] = moveVector
			
			for i in [0...data.length] by 3
				output[i]     = px + data[i]
				output[i + 1] = py + data[i + 1]
				output[i + 2] = pz + data[i + 2]

			_.defer -> callback null, output
	
	get : (position, direction, callback) ->
		
		@lazyInitialize (err) =>
			return callback err if err

			loadedData = []
			
			finalCallback = (err, vertices, colors) ->
				if err
					callback err
				else
					colorsFloat = new Float32Array(colors.length)
					colorsFloat[i] = colors[i] / 255 for i in [0...colors.length]
					callback null, vertices, colorsFloat


			@rotateAndTranslate @vertexTemplate, position, direction, @synchronizingCallback(loadedData, finalCallback)

			@load position, direction, @synchronizingCallback(loadedData, finalCallback)

				

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

		unless @tryCache name, callback

			request url : "/assets/mesh/#{name}", responseType : 'arraybuffer', (err, data) =>
				if err
					callback err 

				else
					try
						header  = new Uint32Array(data, 0, 3)
						coords  = new Float32Array(data, 12, header[0])
						colors  = new Float32Array(data, 12 + header[0] * 4, header[1])
						indexes = new Uint16Array(data, 12 + 4 * (header[0] + header[1]), header[2])

						@cachingCallback(name, callback)(null, coords, colors, indexes)

					catch ex
						callback(ex)

Model.Shader =

	get : (name, callback) ->
		
		unless @tryCache name, callback
		
			loadedData = []
			request url : "/assets/shader/#{name}.vs", (@synchronizingCallback loadedData, (@cachingCallback name, callback))
			request url : "/assets/shader/#{name}.fs", (@synchronizingCallback loadedData, (@cachingCallback name, callback))

	
Model.Route =
	
	dirtyBuffer : []
	route : null
	startDirection : null
	startPosition : null
	id : null

	initialize : (callback) ->

		@startInitializing callback

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
						@startPosition = data.position
						
						callback null, data.position, data.direction
					catch ex
						callback ex
	
	pull : ->
		request	url : "/route/#{@id}", (err, data) =>
			unless err
				@route = JSON.parse data


	push : ->
		@push = _.throttle2 @_push, 30000
		@push()

	_push : ->
		unless @pushing
			@pushing = true

			@lazyInitialize (err) =>
				return if err

				transportBuffer = @dirtyBuffer
				@dirtyBuffer = []
				request
					url : "/route/#{@id}"
					contentType : 'application/json'
					method : 'POST'
					data : transportBuffer
					,
					(err) =>
						@pushing = false
						if err
							@dirtyBuffer = transportBuffer.concat @dirtyBuffer
							@push()
	
	put : (position, callback) ->
		
		@lazyInitialize (err) =>
			return callback(err) if err

			@route.push position
			@dirtyBuffer.push position
			@push()

Model.LazyInitializable =
	
	initialized : false

	lazyInitialize : (callback) ->
		unless @initialized
			if @waitingForInitializing?
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
		
		callback = (args...) ->
			cb(args...) for cb in callbacks
			return

		if err
			callback err
			return
		else
			@initialized = true
			return callback

Model.Synchronizable = 	

	synchronizingCallback : (loadedData, callback) ->
		loadedData.push null
		loadedData.counter = loadedData.length
		i = loadedData.length - 1

		(err, data) ->
			if err
				callback err unless loadedData.errorState
				loadedData._errorState = true
			else
				loadedData[i] = data
				unless --loadedData.counter
					callback null, loadedData...

Model.Cacheable =
	
	cache : {}

	cachingCallback : (cache_tag, callback) ->
		(err, args...) =>
			if err
				callback err
			else
				@cache[cache_tag] = args
				callback null, args...
	
	tryCache : (cache_tag, callback) ->
		if (cached = @cache[cache_tag])?
			_.defer -> callback null, cached...
			return true
		else
			return false



_.extend Model.Binary, Model.Synchronizable
_.extend Model.Binary, Model.LazyInitializable
_.extend Model.Mesh, Model.Cacheable
_.extend Model.Shader, Model.Synchronizable
_.extend Model.Shader, Model.Cacheable
_.extend Model.Route, Model.LazyInitializable
