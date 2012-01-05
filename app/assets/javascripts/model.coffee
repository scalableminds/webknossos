Model ?= {}

Model.BinaryStore =
	
	data : []
	size : [0,0,0]
	offset : [0,0,0]

	BUCKET_WIDTH : 64

	bucketIndex : (x, y, z) ->
		(x / @BUCKET_WIDTH - @offset[0] >> 0) + 
		(y / @BUCKET_WIDTH - @offset[1] >> 0) * @size[0] + 
		(z / @BUCKET_WIDTH - @offset[2] >> 0) * @size[0] * @size[1]
	
	pointIndex : (x, y, z) ->
		(x % @BUCKET_WIDTH >> 0) +
		(y % @BUCKET_WIDTH >> 0) * @BUCKET_WIDTH +
		(z % @BUCKET_WIDTH >> 0) * @BUCKET_WIDTH * @BUCKET_WIDTH

	extendPoints : (x0, y0, z0, x1, y1, z1) ->

		@extendCube(
			x0 / @BUCKET_WIDTH >> 0,
			y0 / @BUCKET_WIDTH >> 0,
			x0 / @BUCKET_WIDTH >> 0,
			x1 / @BUCKET_WIDTH >> 0,
			y1 / @BUCKET_WIDTH >> 0,
			z1 / @BUCKET_WIDTH >> 0
		)

	extendCube : (x0, y0, z0, x1, y1, z1) ->
		
		cubeOffset = [
			Math.min(x0, x1, @offset[0])
			Math.min(y0, y1, @offset[1])
			Math.min(z0, z1, @offset[2])
		]
		cubeSize = [
			Math.max(x0, x1, @offset[0] + @size[0]) - cubeOffset[0] + 1
			Math.max(y0, y1, @offset[1] + @size[1]) - cubeOffset[1] + 1
			Math.max(z0, z1, @offset[2] + @size[2]) - cubeOffset[2] + 1
		]

		cube = []
		for z in [0...cubeSize[2]]
			for y in [0...cubeSize[1]]
				for x in [0...cubeSize[0]]
					index =
						(x - @offset[0]) +
						(y - @offset[1]) * @size[0] +
						(z - @offset[2]) * @size[0] * @size[1] 
					
					cube.push @data[index]
						
					
		@data = cube
		@offset = cubeOffset
		@size = cubeSize

	value : (x, y, z, newValue) ->

		bucketIndex = @bucketIndex(x, y, z)
		bucket = @data[bucketIndex]

		unless newValue?
			if bucket?
				bucket[@pointIndex(x, y, z)]
			else
				-1
		else
			if 0 <= bucketIndex < @data.length
				unless bucket?
					bucket = @data[bucketIndex] = new Float32Array(@BUCKET_WIDTH * @BUCKET_WIDTH * @BUCKET_WIDTH)
					bucket[i] = -1 for i in [0...bucket.length]
				bucket[@pointIndex(x, y, z)] = newValue
			else
				throw "cube fault"

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
		
			_.defer -> 
				callback null, M4x4.transformPointsAffine(mat, data, output)

		
		else

			[px, py, pz] = moveVector
			
			_.defer -> 
				for i in [0...data.length] by 3
					output[i]     = px + data[i]
					output[i + 1] = py + data[i + 1]
					output[i + 2] = pz + data[i + 2]
				callback null, output
		


	get : (vertices, callback) ->

		colors = new Float32Array(~~(vertices.length / 3))

		for i in [0...vertices.length] by 3

			x = vertices[i]
			y = vertices[i + 1]
			z = vertices[i + 2]

			x0 = x >> 0; x1 = x0 + 1; xd = x - x0			
			y0 = y >> 0; y1 = y0 + 1;	yd = y - y0
			z0 = z >> 0; z1 = z0 + 1; zd = z - z0

			colors[i / 3] = if xd == 0
				if yd == 0
					if zd == 0
						@value(x, y, z)
					else
						#linear z
						Interpolation.linear(@value(x, y, z0), @value(x, y, z1), zd)
				else
					if zd == 0
						#linear y
						Interpolation.linear(@value(x, y0, z), @value(x, y1, z), yd)
					else
						#bilinear y,z
						Interpolation.bilinear(
							@value(x, y0, z0), 
							@value(x, y1, z0), 
							@value(x, y0, z1), 
							@value(x, y1, z1), 
							yd, zd)
			else
				if yd == 0
					if zd == 0
						#linear x
						Interpolation.linear(@value(x0, y, z), @value(x1, y, z), xd)
					else
						#bilinear x,z
						Interpolation.bilinear(
							@value(x0, y, z0), 
							@value(x1, y, z0), 
							@value(x0, y, z1), 
							@value(x1, y, z1), 
							xd, zd)
				else
					if zd == 0
						#bilinear x,y
						Interpolation.bilinear(
							@value(x0, y0, z), 
							@value(x1, y0, z), 
							@value(x0, y1, z), 
							@value(x1, y1, z), 
							xd, yd)
					else
						#trilinear x,y,z
						Interpolation.trilinear(
							@value(x0, y0, z0),
							@value(x1, y0, z0),
							@value(x0, y1, z0),
							@value(x1, y1, z0),
							@value(x0, y0, z1),
							@value(x1, y0, z1),
							@value(x0, y1, z1),
							@value(x1, y1, z1),
							xd, yd, zd
						)
		
		callback(null, colors)

	getOld : (position, direction, callback) ->
		
		@lazyInitialize (err) =>
			return callback err if err

			loadedData = []
			
			finalCallback = (err, vertices, colors) =>
				if err
					callback err
				else
					console.time("e")
					max_x = min_x = vertices[0]
					max_y = min_y = vertices[1]
					max_z = min_z = vertices[2]
					for i in [3...vertices.length] by 3
						x = vertices[i]
						y = vertices[i + 1]
						z = vertices[i + 2]
						max_x = if x > max_x then x else max_x
						max_y = if y > max_y then y else max_y
						max_z = if z > max_z then z else max_z
						min_x = if x < min_x then x else min_x
						min_y = if y < min_y then y else min_y
						min_z = if z < min_z then z else min_z
					

					@extendPoints(min_x, min_y, min_z, max_x, max_y, max_z)
					
					for i in [0...colors.length]
						@value(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2], colors[i] / 256)

					console.timeEnd "e"
					callback null if callback


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
					header  = new Uint32Array(data, 0, 3)
					coords  = new Float32Array(data, 12, header[0])
					colors  = new Float32Array(data, 12 + header[0] * 4, header[1])
					indexes = new Uint16Array(data, 12 + 4 * (header[0] + header[1]), header[2])

					@cachingCallback(name, callback)(null, coords, colors, indexes)

Model.Trianglesplane =
	
	get : (width, callback) ->

		# *3 coords per point
		verticesArraySize = width * width * 3

		vertices = new Uint16Array(verticesArraySize)

		# *2 because two triangles per point and 3 points per triangle
		indexes = new Uint16Array(verticesArraySize * 2)
		currentPoint = 0
		currentIndex = 0

		#iterate through all points
		for y in [0..width - 1]
			for x in [0..width - 1]
				# < width -1: because you don't draw a triangle with
				# the last points on each axis.
				if y < (width - 1) and x < (width - 1)
					indexes[currentIndex * 2 + 0] = currentPoint
					indexes[currentIndex * 2 + 1] = currentPoint + 1 
					indexes[currentIndex * 2 + 2] = currentPoint + width
					indexes[currentIndex * 2 + 3] = currentPoint + width
					indexes[currentIndex * 2 + 4] = currentPoint + width + 1
					indexes[currentIndex * 2 + 5] = currentPoint + 1
					
					vertices[currentIndex + 0] = x
					vertices[currentIndex + 1] = y
					vertices[currentIndex + 2] = 0

				currentPoint++
				currentIndex += 3

		callback(null, vertices, indexes)

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

			@route.push [Math.round(position[0]), Math.round(position[1]), Math.round(position[2])]
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


_.extend Model.Binary, Model.BinaryStore
_.extend Model.Binary, Model.Synchronizable
_.extend Model.Binary, Model.LazyInitializable
_.extend Model.Mesh, Model.Cacheable
_.extend Model.Shader, Model.Synchronizable
_.extend Model.Shader, Model.Cacheable
_.extend Model.Route, Model.LazyInitializable
