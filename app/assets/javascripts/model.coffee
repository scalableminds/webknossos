# This is the model. It takes care of the data including the 
# communication with the server.
#
# All public operations are **asynchronous**. Give us a **callback**
# and we'll (ahem) call you back. The first parameter of the callback 
# is always reserved for any occured error. So make sure to check
# whether every thing went right.

Model ?= {}

# #Model.Binary#
# Binary is the real deal.
# It loads and stores the primary graphical data.
#
# **Mixins**: Model.Synchronizable
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
# the data separately. Therefore we can (lazily) load a template of 
# vertices which represent a generic chunk of data.
# Once we really get a request, we then just need to load the color
# data and transform the vertices template to match the position of 
# the data block (see `Model.Binary._ping`). This is pretty efficient 
# as we do not need another roundtrip to the server.
# We then just need to add all the loaded data into our data structure.
#
# ##Querying##
# `Model.Binary.get` provides an interface to query the stored data.
# Give us an array of coordinates (vertices) and we'll give you the 
# corresponding color values. Keep in mind that valid color values
# are in the range from 1 to 2. 0 would be an unknown point.
#
# There is no need for you to send us rounded vertex values because
# we try to interpolate under the hood. We apply either a linear,
# bilinear or trilinear interpolation so the result should be quite
# smooth. However, if one of the required 2, 4 or 8 points is missing
# we'll decide that your requested point is missing aswell.
# 
# 
# This is a cuboid. With buckets. If you haven't noticed yet.
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
	
	verticesTemplate : null
	
	# We use lazy initialization load the vertex template.
	# This method can only be called once if initialization succeeds.
	initializeVerticesTemplate : (callback) ->
		@initializeVerticesTemplate = _.once2(@_initializeVerticesTemplate)
		@initializeVerticesTemplate(callback)

	_initializeVerticesTemplate : (doneCallback) ->
		
		request
			url : '/binary/model/cube'
			responseType : 'arraybuffer'
			,	
			(err, data) =>
				
				callback = doneCallback(err)
				
				unless err
					@verticesTemplate = new Int8Array(data)
					callback() if callback
				
				return

	# This method gives you the vertices for a chunk of data (mostly a cube). 
	# You need to provide the position and direction of the cube you're looking 
	# for.
	#
	# Imagine you want to load a cube which sits arbitrarily in 3d space i.e. 
	# it has an arbitrary position and arbitrary orientation (direction). 
	# Because we have a template cube full of vertices at a standard position 
	# `[0,0,0]` with a standard orientation `[0,1,0]` it is just a matter of
	# applying a transformation matrix. Specifically, we rotate and translate
	# the template. Big ups to [Vladimir Vukićević](http://vlad1.com/) for
	# writing the mjs-js (matrix javascripat) library.
	#
	# Parameters:
	#
	# *   `position` is a 3-element array representing the center point of the 
	# front of the cube. 
	# *   `direction` is also 3-element array representing the vector of the axis
	# spiking through the center of front and back
	# 
	# Callback Parameters:
	#
	# *   `vertices` is a `Float32Array` with the transformed values. Every three
	# elements represent the coordinates of a vertex.
	#
	# Example: `Model.Binary.vertices([23, 42, 12], [1,2,3], (err, vertices) -> ...)`
	#
	pullVertices : (position, direction, callback) ->
		
		# Some lazy initialization magic.
		@initializeVerticesTemplate (err) =>
			
			return callback(err) if err and callback
			
			# Defer computation so the current stack isn't blocked
			_.defer =>
				callback(null, M4x4.moveVertices(@verticesTemplate, position, direction)) if callback


	# This method allows you to query the data structure. Give us an array of
	# vertices and we'll give you the corresponding color values. We'll even
	# do some interpolation so the result is smoother.
	# 
	# Parameters:
	# 
	# *   `vertices` is a `Float32Array with the vertices you'd like to query. There
	# is no need for you to round the coordinates. Otherwise you'd have a nearest-
	# neighbor-interpolation, which isn't pretty and kind of wavey. Every three
	# elements (x,y,z) represent one vertex.
	#
	# Callback Parameters:
	# 
	# *   `colors` is a `Float32Array` containing the color values of the requested
	# points.
	#
	get : (vertices, callback) ->

		console.time("get")
		_this  = @
		_value = (x0, y0, z0) ->
			_this.getColor(x0, y0, z0)

		colors = new Float32Array(vertices.length / 3 >> 0)

		for i in [0...vertices.length] by 3

			x = vertices[i]
			y = vertices[i + 1]
			z = vertices[i + 2]

			colors[i / 3] = interpolate(x, y, z, _value)
		
		console.timeEnd("get")
		callback(null, colors) if callback

	

	PRELOAD_TOLERANCE : 0.95
	preloadVertices : []

	# Use this method to let us know when you've changed your spot. Then we'll try to 
	# preload some data. 
	#
	# Parameters:
	#
	# *   `position` is a 3-element array representing the point you're currently at
	# *   `direction` is a 3-element array representing the vector of the direction 
	# you look at
	#
	# No Callback Paramters
	ping : (position, direction, callback) ->

		@ping = _.throttle2(_.mutex(_.bind(@_ping, @)), 500, false)
		@ping(position, direction, callback)

	_ping : (position, direction, callback, done) ->

		callback() if callback

		_.defer =>
			
			_preloadVertices = @preloadVertices
		
			# Looks like `preload_vertices` hasn't been populated yet.
			# This is what ppl call lazy initialization.
			if _preloadVertices.length == 0
				for x in [-20..20] by 5
					for y in [0..10] by 5
						for z in [-20..20] by 5
							_preloadVertices.push x, y, z

			preloadCheckHits     = 0
			preloadCheckCount    = 0
			preloadCheckVertices = M4x4.moveVertices _preloadVertices, position, direction
			for i in [0...preloadCheckVertices.length] by 3
				x = preloadCheckVertices[i]
				y = preloadCheckVertices[i + 1]
				z = preloadCheckVertices[i + 2]

				if x >= 0 and y >= 0 and z >= 0 
					preloadCheckCount++
					preloadCheckHits++ if @value(x, y, z) > 0
			
			if preloadCheckHits / preloadCheckCount < @PRELOAD_TOLERANCE
				@pull(position, direction, done)
			else
				done()
			

	pull : (position, direction, callback) ->

		loadedData = []
		
		finalCallback = (err, vertices, colors) =>
			if err
				callback err if callback

			else
				# First let's find out what extent the points have we just loaded.
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
				
				min_x = if min_x < 0 then 0 else min_x
				min_y = if min_y < 0 then 0 else min_y
				min_z = if min_z < 0 then 0 else min_z
				max_x = if max_x < 0 then 0 else max_x
				max_y = if max_y < 0 then 0 else max_y
				max_z = if max_z < 0 then 0 else max_z


				# Maybe we need to expand our data structure.
				@extendPoints(min_x, min_y, min_z, max_x, max_y, max_z)
				
				# Then we'll just put the point in to our data structure.
				for i in [0...colors.length]
					x = vertices[i * 3]
					y = vertices[i * 3 + 1]
					z = vertices[i * 3 + 2]
					if x >= 0 and y >= 0 and z >= 0
						@value(x, y, z, colors[i] / 256 + 1)

				callback null if callback

		# We use synchronized callbacks to make sure both callbacks have returned.
		@pullVertices position, direction, @synchronizingCallback(loadedData, finalCallback)

		@load position, direction, @synchronizingCallback(loadedData, finalCallback)

	load : (position, direction, callback) ->
		
		request
			url : "/binary/data/cube?px=#{Math.round(position[0])}&py=#{Math.round(position[1])}&pz=#{Math.round(position[2])}&ax=#{direction[0]}&ay=#{direction[1]}&az=#{direction[2]}"
			responseType : 'arraybuffer'
			,
			(err, data) ->
				if err
					callback(err) if callback
				else
					callback(null, new Uint8Array(data)) if callback
	
	# Now comes the implementation of our internal data structure.
	# `cube` is the main array. It actually represents a cuboid 
	# containing all the buckets. `cubeSize` and `cubeOffset` 
	# describe its dimension.
	cube : null
	cubeSize : null
	cubeOffset : null

	# Each bucket is 64x64x64 large.
	# Implementation note: This isn't really a variable and hard-coded
	# all over the place for performance concerns.
	BUCKET_WIDTH : 1 << 6

	# Retuns the index of the bucket (in the cuboid) which holds the
	# point you're looking for.
	bucketIndex : (x, y, z) ->
		
		_offset = @cubeOffset
		_size   = @cubeSize

		((x >> 6) - _offset[0]) + 
		((y >> 6) - _offset[1]) * _size[0] + 
		((z >> 6) - _offset[2]) * _size[0] * _size[1]
	
	# Returns the index of the point (in the bucket) you're looking for.
	pointIndex : (x, y, z) ->
		
		# x % 64 + y % 64 * 64 + z % 64 * 64^2
		(x & -64) +
		((y & -64) << 6) +
		((z & -64) << 12)

	# Want to add data? Make sure the cuboid is big enough.
	# This one is for passing real point coordinates.
	extendPoints : (x_min, y_min, z_min, x_max, y_max, z_max) ->
		
		@extendCube(
			x_min >> 6, # x_min / 64
			y_min >> 6,
			x_min >> 6,
			x_max >> 6,
			y_max >> 6,
			z_max >> 6
		)
	
	# And this one is for passing bucket coordinates.
	extendCube : (x0, y0, z0, x1, y1, z1) ->
		
		_cube   = @cube
		_offset = @cubeOffset
		_size   = @cubeSize

		# First, we calculate the new dimension of the cuboid.
		if _cube?
			cubeOffset = [
				Math.min(x0, x1, _offset[0])
				Math.min(y0, y1, _offset[1])
				Math.min(z0, z1, _offset[2])
			]
			cubeSize = [
				Math.max(x1 - x0 + 1, _size[0])
				Math.max(y1 - y0 + 1, _size[1])
				Math.max(z1 - z0 + 1, _size[2])
			]
		else
			cubeOffset = [
				Math.min(x0, x1)
				Math.min(y0, y1)
				Math.min(z0, z1)
			]
			cubeSize = [
				Math.max(x0, x1) - cubeOffset[0] + 1
				Math.max(y0, y1) - cubeOffset[1] + 1
				Math.max(z0, z1) - cubeOffset[2] + 1
			]

		# Then we reorganize the existing buckets.
		cube = []
		for z in [0...cubeSize[2]]
			for y in [0...cubeSize[1]]
				for x in [0...cubeSize[0]]
					cube.push if _cube?
						index = 
							(x - _offset[0]) +
							(y - _offset[1]) * _size[0] +
							(z - _offset[2]) * _size[0] * _size[1]
						_cube[index]
					else
						null
					
		@cube       = cube
		@cubeOffset = cubeOffset
		@cubeSize   = cubeSize

	# Work in progress
	getColor2 : (x, y, z, c) ->

		unless (_cube = @cube)
			return 0

		_offset = @cubeOffset
		_size   = @cubeSize

		[_offset0, _offset1, _offset2] = _offset
		[_size0, _size1, _size2] = _size

		_size01 = _size0 * _size1

		_bucketIndex000 = 
			((x >> 6) - _offset0) + 
			((y >> 6) - _offset1) * _size0 + 
			((z >> 6) - _offset2) * _size01
		_pointIndex000 = 
			((x & -64)) +
			((y & -64) << 6) +
			((z & -64) << 12)
		
			


	# A faster implementation of `Model.Binary.value`, but only for
	# getting color values.
	getColor : (x, y, z) ->
		
		unless (_cube = @cube)
			return 0

		_offset = @cubeOffset
		_size   = @cubeSize

		_bucketIndex = 
			((x >> 6) - _offset[0]) + 
			((y >> 6) - _offset[1]) * _size[0] + 
			((z >> 6) - _offset[2]) * _size[0] * _size[1]
		
		_pointIndex = 
			((x & -64)) +
			((y & -64) << 6) +
			((z & -64) << 12)
		
		if (_bucket = _cube[_bucketIndex])
			_bucket[_pointIndex]
		else
			0

	# Get or set a color value of a point.
	# Keep in mind that 0 represents a undefined value.
	# Real color values range from 1 to 2 -- with black being 0 and white 1.
	value : (x, y, z, newValue) ->

		_cube = @cube

		unless _cube?
			throw "cube fault" if newValue?
			return 0

		bucketIndex = @bucketIndex(x, y, z)
		bucket      = _cube[bucketIndex]

		unless newValue?
			if bucket?
				bucket[@pointIndex(x, y, z)]
			else
				0
		else
			if 0 <= bucketIndex < @cube.length
				unless bucket?
					bucket = _cube[bucketIndex] = new Float32Array(1 << 18)
				bucket[@pointIndex(x, y, z)] = newValue
			else
				# Please handle cuboid expansion explicitly.
				throw "cube fault"

# This loads and caches meshes.
#
# **Mixins**: Model.Cacheable
Model.Mesh =
	
	get : (name, callback) ->

		unless @tryCache name, callback

			request url : "/assets/mesh/#{name}", responseType : 'arraybuffer', (err, data) =>
				if err
					callback err if callback

				else
				  # To save bandwidth meshes are transferred in a binary format.
					header  = new Uint32Array(data, 0, 3)
					coords  = new Float32Array(data, 12, header[0])
					colors  = new Float32Array(data, 12 + header[0] * 4, header[1])
					indexes = new Uint16Array(data, 12 + 4 * (header[0] + header[1]), header[2])

					# `Model.Cacheable.cachingCallback`
					@cachingCallback(name, callback)(null, coords, colors, indexes)

# This creates a Triangleplane
# It is essentially a square with a grid of vertices. Those vertices are
# connected through triangles. Cuz that's how u do it in WebGL.
Model.Trianglesplane =
	
	get : (width, zOffset, callback) ->

		# Each three elements represent one vertex.
		vertices = new Float32Array(width * width * 3)

		# Each three elements represent one triangle.
		# And each vertex is connected through two triangles.
		indices = new Uint16Array(width * width * 6)
		currentPoint = 0
		currentIndex = 0

		for y in [0...width]
			for x in [0...width]
				# We don't draw triangles with the last point of an axis.
				if y < (width - 1) and x < (width - 1)
					indices[currentIndex * 2 + 0] = currentPoint
					indices[currentIndex * 2 + 1] = currentPoint + 1 
					indices[currentIndex * 2 + 2] = currentPoint + width
					indices[currentIndex * 2 + 3] = currentPoint + width
					indices[currentIndex * 2 + 4] = currentPoint + width + 1
					indices[currentIndex * 2 + 5] = currentPoint + 1
				else
					indices[currentIndex * 2 + 0] = 0
					indices[currentIndex * 2 + 1] = 0
					indices[currentIndex * 2 + 2] = 0
					indices[currentIndex * 2 + 3] = 0
					indices[currentIndex * 2 + 4] = 0
					indices[currentIndex * 2 + 5] = 0

				vertices[currentIndex + 0] = x
				vertices[currentIndex + 1] = y
				vertices[currentIndex + 2] = zOffset

				currentPoint++
				currentIndex += 3

		callback(null, vertices, indices) if callback

# This loads and caches a pair (vertex and fragment) shaders
#
# **Mixins**: Model.Cacheable
Model.Shader =

	get : (name, callback) ->
		
		unless @tryCache name, callback
		
			loadedData = []
			request url : "/assets/shader/#{name}.vs", (@synchronizingCallback loadedData, (@cachingCallback name, callback))
			request url : "/assets/shader/#{name}.fs", (@synchronizingCallback loadedData, (@cachingCallback name, callback))


# This takes care of the route. 
Model.Route =
	
	dirtyBuffer : []
	route : null
	startDirection : null
	startPosition : null
	id : null

	# Returns a `position` and `direction` to start your work.
	initialize : (callback) ->
		@initialize = _.once2(@_initialize)
		@initialize(callback)

	_initialize : (doneCallback) ->

		request
			url : '/route/initialize'
			,
			(err, data) =>
				
				callback = doneCallback(err)
				
				unless err
					try
						data = JSON.parse data

						@route          = [ data.position ]
						@id             = data.id
						@startDirection = data.direction
						@startPosition  = data.position
						
						callback(null, data.position, data.direction)
					catch ex
						callback ex
	
	# Pulls a route from the server.
	pull : ->
		request	url : "/route/#{@id}", (err, data) =>
			unless err
				@route = JSON.parse data

	
	# Pushes th buffered route to the server. Pushing happens at most 
	# every 30 seconds.
	push : ->
		@push = _.throttle2 @_push, 30000
		@push()

	_push : ->
		unless @pushing
			@pushing = true

			@initialize (err) =>
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
	
	# Add a point to the buffer. Just keep adding them.
	put : (position, callback) ->
		
		@initialize (err) =>
			return callback(err) if err and callback

			position = [Math.round(position[0]), Math.round(position[1]), Math.round(position[2])]
			_lastPosition = _.last(@route)
			unless _lastPosition[0] == position[0] and _lastPosition[1] == position[1] and _lastPosition[2] == position[2]
				@route.push position
				@dirtyBuffer.push position
				@push()


# Helps to make sure that a bunch of callbacks have returned before 
# your code continues.
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
					callback(null, loadedData...) if callback

# Hook up your callbacks with a caching mechansim. So: First check the
# cache with `tryCache`, then do your stuff and hook up the 
# `cachingCallback` to your callbacks.
Model.Cacheable =
	
	cache : {}

	cachingCallback : (cache_tag, callback) ->
		(err, args...) =>
			if err
				callback err
			else
				@cache[cache_tag] = args
				callback(null, args...) if callback
	
	tryCache : (cache_tag, callback) ->
		if (cached = @cache[cache_tag])?
			if callback
				_.defer -> callback(null, cached...)
			return true
		else
			return false

# Mixin hook ups
_.extend Model.Binary, Model.Synchronizable
_.extend Model.Mesh, Model.Cacheable
_.extend Model.Shader, Model.Synchronizable
_.extend Model.Shader, Model.Cacheable
