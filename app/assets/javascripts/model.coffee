# Initializing `Model`
Model ?= {}

# #Model.Binary#
# Binary is the real deal.
# It loads and stores the primary graphical data.
#
# **Mixins**: Model.LazyInitializable, Model.Synchronizable
# 
# ##Data structure##
#
# ###Concept###
# We store 3-dimensional data with each coordinate >= [0,0,0].
# Each point is stored in **buckets** which resemble a cubical grid. 
# Those buckets are kept in an expandable data structure (**cube**) which 
# represents the smallest cuboid covering all used buckets.
# 
# ###Implementation###
# Each point value (greyscale color) is represented by a number 
# between 1 and 2, where 1 is black and 2 white. Actually WebGL
# generally uses [0, 1], but as TypedArrays are initialized with
# 0 we shift the actual interval to use 0 as an undefined value.
# 
# The buckets are implemented as `Float32Array`s with a length of
# `BUCKET_WIDTH ^ 3`. Each point can be easiliy found through simple 
# arithmetik (see `Model.Binary.pointIndex`).
#
# The cube is defined by the offset `[x,y,z]` and size `[a,b,c]` 
# of the cuboid. It is actually just a standard javascript array 
# with each item being either `null` or a bucket. The length of the
# array is `a * b * c`. Also finding th containing bucket of a point 
# can be done with pretty simple math (see `Model.Binary.bucketIndex`).
#
# ###Inserting###
# When inserting new data into the data structure we first need
# to make sure the cube is big enough to cover all points. Otherwise
# we'll have to expand the cube (see `Model.Binary.expandCube`). 
# Then we add each point. If the corresponding bucket of a point 
# isn't initialized we'll handle that on the fly 
# (see `Model.Binary.value`).
# 
#
# ##Loading##
# The server provides the coordinates (vertices) and color values of
# the data separately.
# 
# 
# 
#         +--+--+--+--+--+--+--+
#        /  /  /  /  /  /  /  /|
#       /--/--/--/--/--/--/--/ |
#      /  /  /  /  /  /  /  /|/|
#     +--+--+--+--+--+--+--+ | |
#     |  |  |  |  |  |  |  |/|/|
#     |--|--|--|--|--|--|--| | |
#     |  |  |  |  |  |  |  |/|/
#     |--|--|--|--|--|--|--| /
#     |  |  |  |  |  |  |  |/
#     +--+--+--+--+--+--+--+
#
#

#
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

		_value = @value
		
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
						_value(x, y, z)
					else
						#linear z
						Interpolation.linear(_value(x, y, z0), _value(x, y, z1), zd)
				else
					if zd == 0
						#linear y
						Interpolation.linear(_value(x, y0, z), _value(x, y1, z), yd)
					else
						#bilinear y,z
						Interpolation.bilinear(
							_value(x, y0, z0), 
							_value(x, y1, z0), 
							_value(x, y0, z1), 
							_value(x, y1, z1), 
							yd, zd)
			else
				if yd == 0
					if zd == 0
						#linear x
						Interpolation.linear(_value(x0, y, z), _value(x1, y, z), xd)
					else
						#bilinear x,z
						Interpolation.bilinear(
							_value(x0, y, z0), 
							_value(x1, y, z0), 
							_value(x0, y, z1), 
							_value(x1, y, z1), 
							xd, zd)
				else
					if zd == 0
						#bilinear x,y
						Interpolation.bilinear(
							_value(x0, y0, z), 
							_value(x1, y0, z), 
							_value(x0, y1, z), 
							_value(x1, y1, z), 
							xd, yd)
					else
						#trilinear x,y,z
						Interpolation.trilinear(
							_value(x0, y0, z0),
							_value(x1, y0, z0),
							_value(x0, y1, z0),
							_value(x1, y1, z0),
							_value(x0, y0, z1),
							_value(x1, y0, z1),
							_value(x0, y1, z1),
							_value(x1, y1, z1),
							xd, yd, zd
						)
		
		callback(null, colors)

	
	ping : (position, direction, callback) ->

		@ping = _.throttle2 @_ping, 20000
		@ping(position, direction, callback)

	_ping : (position, direction, callback) ->
		
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
					
					min_x = if x < 0 then 0 else x
					min_y = if y < 0 then 0 else y
					min_z = if z < 0 then 0 else z
					max_x = if x < 0 then 0 else x
					max_y = if y < 0 then 0 else y
					max_z = if z < 0 then 0 else z


					@extendPoints(min_x, min_y, min_z, max_x, max_y, max_z)
					
					for i in [0...colors.length]
						x = vertices[i * 3]
						y = vertices[i * 3 + 1]
						z = vertices[i * 3 + 2]
						if x >= 0 and y >= 0 and z >= 0
							@value(x, y, z, colors[i] / 256 + 1)

					console.timeEnd "e"
					callback null if callback


			@rotateAndTranslate @vertexTemplate, position, direction, @synchronizingCallback(loadedData, finalCallback)

			@load position, direction, @synchronizingCallback(loadedData, finalCallback)

	load : (position, direction, callback) ->
		@lazyInitialize (err) ->
			return callback(err) if err

			request
				url : "/binary/data/cube?px=#{position[0]}&py=#{position[1]}&pz=#{position[2]}&ax=#{direction[0]}&ay=#{direction[1]}&az=#{direction[2]}"
				responseType : 'arraybuffer'
				,
				(err, data) ->
					if err
						callback err
					else
						callback null, new Uint8Array(data) 
	
	data : []
	size : [0,0,0]
	offset : [0,0,0]

	BUCKET_WIDTH : 64

	bucketIndex : (x, y, z) ->
		
		_bucket_width = @BUCKET_WIDTH
		_offset = @offset
		_size = @size

		(x / _bucket_width - _offset[0] >> 0) + 
		(y / _bucket_width - _offset[1] >> 0) * _size[0] + 
		(z / _bucket_width - _offset[2] >> 0) * _size[0] * _size[1]
	
	pointIndex : (x, y, z) ->
		
		_bucket_width = @BUCKET_WIDTH

		(x % _bucket_width >> 0) +
		(y % _bucket_width >> 0) * _bucket_width +
		(z % _bucket_width >> 0) * _bucket_width * _bucket_width

	extendPoints : (x0, y0, z0, x1, y1, z1) ->
		
		_bucket_width = @BUCKET_WIDTH

		@extendCube(
			x0 / _bucket_width >> 0,
			y0 / _bucket_width >> 0,
			x0 / _bucket_width >> 0,
			x1 / _bucket_width >> 0,
			y1 / _bucket_width >> 0,
			z1 / _bucket_width >> 0
		)

	extendCube : (x0, y0, z0, x1, y1, z1) ->
		
		_offset = @offset
		_size = @size
		_data = @data

		cubeOffset = [
			Math.min(x0, x1, _offset[0])
			Math.min(y0, y1, _offset[1])
			Math.min(z0, z1, _offset[2])
		]
		cubeSize = [
			Math.max(x0, x1, _offset[0] + _size[0]) - cubeOffset[0] + 1
			Math.max(y0, y1, _offset[1] + _size[1]) - cubeOffset[1] + 1
			Math.max(z0, z1, _offset[2] + _size[2]) - cubeOffset[2] + 1
		]

		cube = []
		for z in [0...cubeSize[2]]
			for y in [0...cubeSize[1]]
				for x in [0...cubeSize[0]]
					index =
						(x - _offset[0]) +
						(y - _offset[1]) * _size[0] +
						(z - _offset[2]) * _size[0] * _size[1] 
					
					cube.push _data[index]
						
					
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
					_bucket_width = @BUCKET_WIDTH
					bucket = @data[bucketIndex] = new Float32Array(_bucket_width * _bucket_width * _bucket_width)
				bucket[@pointIndex(x, y, z)] = newValue
			else
				throw "cube fault"


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



#################################################
# Mixins
#################################################

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


#################################################
# Mixin hook up
#################################################

_.extend Model.Binary, Model.Synchronizable
_.extend Model.Binary, Model.LazyInitializable
_.extend Model.Mesh, Model.Cacheable
_.extend Model.Shader, Model.Synchronizable
_.extend Model.Shader, Model.Cacheable
_.extend Model.Route, Model.LazyInitializable
