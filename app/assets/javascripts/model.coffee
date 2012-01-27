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
	calcVertices : (matrix) ->
		
		returnDeferred = $.Deferred()

		worker = @pullVerticesWorker ||= new Worker("/assets/javascripts/pullVerticesWorker.js")
		
		workerHandle = Math.random()
		workerCallback = (event) ->
			
			if (args = event.data).workerHandle == workerHandle
				worker.removeEventListener("message", workerCallback, false)
				if err = args.err
					returnDeferred.reject(err)
				else 
					returnDeferred.resolve(args)

		worker.addEventListener("message", workerCallback, false)
		
		worker.postMessage { matrix, workerHandle }
		
		returnDeferred.promise()


	# This method allows you to query the data structure. Give us an array of
	# vertices and we'll give you the stuff you need to interpolate data.
	#
	# We'll figure out how many color values you need to do interpolation.
	# That'll be 1, 2, 4 or 8 values. They represent greyscale colors ranging from
	# 1 to 2. Additionally, you need three delta values xd, yd and zd which are in
	# the range from 0 to 1. Then you should be able to perform a trilinear 
	# interpolation. To sum up, you get 11 floating point values for each point.
	# We spilt those in three array buffers to have them used in WebGL shaders as 
	# vec4 and vec3 attributes.
	# 
	# While processing the data several errors can occur. Please note that 
	# processing of a point halts if any of the required color values is wrong.
	# You can determine any errors by examining the first value of each point.
	# Feel free to color code those errors as you wish.
	#
	# *   `-2`: negative coordinates given
	# *   `-1`: block fault
	# *   `0`: point fault
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
	# *   `bufferFront` is a `Float32Array` with the first 4 color values of
	# each points. The first value would contain any error codes.
	# *   `bufferBack` is a `Float32Array` with the second 4 color values of
	# each points.
	# *   `bufferDelta` is a `Float32Array` with the delta values.
	#
	get : (vertices, callback) ->

		console.time("get")
		bufferFront = new Float32Array(vertices.length / 3 << 2)
		bufferBack  = new Float32Array(vertices.length / 3 << 2)
		bufferDelta = new Float32Array(vertices.length)
		
		if (_cube = @cube)
			
			size0  = @cubeSize[0]
			size01 = @cubeSize[0] * @cubeSize[1]
			
			lowerBound0 = @cubeOffset[0] << 6
			lowerBound1 = @cubeOffset[1] << 6
			lowerBound2 = @cubeOffset[2] << 6
			upperBound0 = (@cubeOffset[0] + @cubeSize[0]) << 6
			upperBound1 = (@cubeOffset[1] + @cubeSize[1]) << 6
			upperBound2 = (@cubeOffset[2] + @cubeSize[2]) << 6

			j3 = 0
			j4 = 0

			for i in [0...vertices.length] by 3

				x = vertices[i]
				y = vertices[i + 1]
				z = vertices[i + 2]

				InterpolationCollector.collect(
					x, y, z, 
					bufferFront, bufferBack, bufferDelta, 
					j4, j3, 
					_cube, 
					lowerBound0, lowerBound1, lowerBound2,
					upperBound0, upperBound1, upperBound2,
					size0, size01)

				j3 += 3
				j4 += 4
			
		console.timeEnd("get")
		callback(null, bufferFront, bufferBack, bufferDelta) if callback

	

	PRELOAD_TOLERANCE : 0.9
	PRELOAD_RADIUS : 37
	
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
	ping : (matrix, callback) ->

		@ping = _.throttle2(_.mutex(_.bind(@_ping, @), 5000), 500, false)
		@ping(matrix, callback)

	_ping : (matrix, callback, done) ->

		promises = []
		_preloadRadius    = @PRELOAD_RADIUS
		_preloadTolerance = @PRELOAD_TOLERANCE
		
		for x0 in [-_preloadRadius.._preloadRadius] by _preloadRadius * 2
			for y0 in [-_preloadRadius.._preloadRadius] by _preloadRadius * 2
				if promise = @preload(matrix, x0, y0, 0, _preloadRadius * 2)
					promises.push(promise)
				else
					for z in [-1...15] by 3
						if promise = @preload(matrix, x0, y0, z, _preloadRadius * 2)
							promises.push(promise)
							break

		$.when(promises...)
			.always(-> callback())
			.always(done)

	
	preload : (matrix, x0, y0, z, width, sparse = 5) ->

		if @preloadTest(matrix, x0, y0, z, width, sparse) < @PRELOAD_TOLERANCE
			@pull(M4x4.translate([x0, y0, z - 1], matrix))
		else
			false

	preloadTest : (matrix, x0, y0, z, width, sparse) ->

		vertices = []
		for x in [x0...(x0 + width)] by sparse
			for y in [y0...(y0 + width)] by sparse
				vertices.push x, y, z

		vertices = M4x4.transformPointsAffine matrix, vertices

		count = hits = 0
		for i in [0...vertices.length] by 3
			x = vertices[i]
			y = vertices[i + 1]
			z = vertices[i + 2]

			if x >= 0 and y >= 0 and z >= 0 
				count++
				hits++ if @getColor(x, y, z) > 0
		
		hits / count


	pull : (matrix) ->

		$.when(@loadColors(matrix), @calcVertices(matrix))

			.pipe (colors, { vertices, minmax }) =>
				# Maybe we need to expand our data structure.
				@extendPoints(minmax...)
				
				console.error("Color (#{colors.length}) and vertices (#{vertices.length / 3}) count doesn't match.") if vertices.length != colors.length * 3

				# Then we'll just put the point in to our data structure.
				for i in [0...colors.length]
					x = vertices[i * 3]
					y = vertices[i * 3 + 1]
					z = vertices[i * 3 + 2]
					if x >= 0 and y >= 0 and z >= 0
						@setColor(x, y, z, colors[i] / 256 + 1)

				return arguments

	

	loadColors : (matrix) ->
		
		returnDeferred = $.Deferred()

		_WebSocket = if window['MozWebSocket'] then MozWebSocket else WebSocket

		unless @loadSocket
			socket = @loadSocket = new _WebSocket("ws://#{document.location.host}/binary/ws/cube")
			openDeferred = @loadSocketOpenDeferred = $.Deferred()

			socket.binaryType = 'arraybuffer'
			socket.onclose = (code, reason) -> console.error("socket closed", "#{code}: #{reason}")
			socket.onopen = -> openDeferred.resolve()
			setTimeout((-> openDeferred.reject("timeout")), 20000)

		else
			socket = @loadSocket
			openDeferred = @loadSocketOpenDeferred
		
		socketHandle = Math.random()

		socketErrorCallback = (err) ->
			socket.removeEventListener("message", socketCallback, false)
			socket.removeEventListener("error", socketErrorCallback, false)
			returnDeferred.reject(err)
		
		socketCallback = (event) ->
			buffer = event.data
			handle = new Float32Array(buffer, 0, 1)[0]
			if handle == socketHandle
				socket.removeEventListener("message", socketCallback, false)
				socket.removeEventListener("error", socketErrorCallback, false)
				returnDeferred.resolve(new Uint8Array(buffer, 4))

		socket.addEventListener("message", socketCallback, false)
		socket.addEventListener("error", socketErrorCallback, false)

		transmitPackage = new Float32Array(17)
		transmitPackage[0] = socketHandle
		transmitPackage.set(matrix, 1)
		socketHandle = transmitPackage[0]
		console.log("request", transmitPackage)

		openDeferred.done(-> socket.send(transmitPackage.buffer))
		returnDeferred.promise()
		
	
	# Now comes the implementation of our internal data structure.
	# `cube` is the main array. It actually represents a cuboid 
	# containing all the buckets. `cubeSize` and `cubeOffset` 
	# describe its dimension.
	# Each bucket is 64x64x64 large. This isnt really variable
	# because the bitwise operations require the width to be a
	# a power of 2.
	cube : null
	cubeSize : null
	cubeOffset : null

	# Retuns the index of the bucket (in the cuboid) which holds the
	# point you're looking for.
	bucketIndex : (x, y, z) ->
		
		_offset = @cubeOffset
		_size   = @cubeSize

		# (x / 64) - offset.x + 
		# ((y / 64) - offset.y) * size.x + 
		# ((z / 64) - offset.z) * size.x * size.y
		((x >> 6) - _offset[0]) + 
		((y >> 6) - _offset[1]) * _size[0] + 
		((z >> 6) - _offset[2]) * _size[0] * _size[1]
	
	# Returns the index of the point (in the bucket) you're looking for.
	pointIndex : (x, y, z) ->
		
		# x % 64 + (y % 64) * 64 + (z % 64) * 64^2
		(x & 63) +
		((y & 63) << 6) +
		((z & 63) << 12)

	# Want to add data? Make sure the cuboid is big enough.
	# This one is for passing real point coordinates.
	extendPoints : (x_min, y_min, z_min, x_max, y_max, z_max) ->
		
		@extendCube(
			x_min >> 6, # x_min / 64
			y_min >> 6,
			z_min >> 6,
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
			_upperBound = [
				_offset[0] + _size[0]
				_offset[1] + _size[1]
				_offset[2] + _size[2]
			]

			cubeOffset = [
				Math.min(x0, x1, _offset[0])
				Math.min(y0, y1, _offset[1])
				Math.min(z0, z1, _offset[2])
			]
			cubeSize = [
				Math.max(x0, x1, _upperBound[0] - 1) - cubeOffset[0] + 1
				Math.max(y0, y1, _upperBound[1] - 1) - cubeOffset[1] + 1
				Math.max(z0, z1, _upperBound[2] - 1) - cubeOffset[2] + 1
			]

			# Just reorganize the existing buckets when the cube dimensions 
			# have changed.
			if cubeOffset[0] != _offset[0] or 
			cubeOffset[1] != _offset[1] or 
			cubeOffset[2] != _offset[2] or 
			cubeSize[0] != _size[0] or 
			cubeSize[1] != _size[1] or 
			cubeSize[2] != _size[2]
				
				cube = []

				for z in [0...cubeSize[2]]
					
					# Bound checking is necessary.
					if _offset[2] <= z + cubeOffset[2] < _upperBound[2]
						
						for y in [0...cubeSize[1]]
						
							if _offset[1] <= y + cubeOffset[1] < _upperBound[1]
						
								for x in [0...cubeSize[0]]
						
									cube.push if _cube? and _offset[0] <= x + cubeOffset[0] < _upperBound[0]
										index = 
											(x + cubeOffset[0] - _offset[0]) +
											(y + cubeOffset[1] - _offset[1]) * _size[0] +
											(z + cubeOffset[2] - _offset[2]) * _size[0] * _size[1]
										_cube[index]
									else
										null
							else
								cube.push(null) for x in [0...cubeSize[0]]
									
					else
						cube.push(null) for xy in [0...(cubeSize[0] * cubeSize[1])]
					
				@cube       = cube
				@cubeOffset = cubeOffset
				@cubeSize   = cubeSize
						
		
		else
			# Before, there wasn't any cube.
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
			cube = []
			cube.push(null) for xyz in [0...(cubeSize[0] * cubeSize[1] * cubeSize[2])]
			
			@cube       = cube
			@cubeOffset = cubeOffset
			@cubeSize   = cubeSize


	# Getting a color value from the data structure.
	# Color values range from 1 to 2 -- with black being 0 and white 1.
	getColor : (x, y, z) ->
		
		unless (_cube = @cube)
			return 0
		
		if (_bucket = _cube[@bucketIndex(x, y, z)])
			_bucket[@pointIndex(x, y, z)]
		else
			0

	# Set a color value of a point.
	# Color values range from 1 to 2 -- with black being 0 and white 1.
	setColor : (x, y, z, value) ->

		_cube = @cube

		throw "cube fault" unless _cube?

		bucketIndex = @bucketIndex(x, y, z)
		bucket      = _cube[bucketIndex]

		if 0 <= bucketIndex < @cube.length
			unless bucket?
				bucket = _cube[bucketIndex] = new Float32Array(1 << 18)
			bucket[@pointIndex(x, y, z)] = value
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
		
		# so we have Point 0 0 0 centered
		startIndex = - Math.floor width/2
		endIndex = startIndex + width
		
		# Each three elements represent one vertex.
		vertices = new Float32Array(width * width * 3)

		# Each three elements represent one triangle.
		# And each vertex is connected through two triangles.
		indices = new Uint16Array(width * width * 6)
		currentPoint = 0
		currentIndex = 0

		for y in [startIndex...endIndex]
			for x in [startIndex...endIndex]
				currentIndex2 = currentIndex << 1

				# We don't draw triangles with the last point of an axis.
				if y < (endIndex - 1) and x < (endIndex - 1)
					indices[currentIndex2 + 0] = currentPoint
					indices[currentIndex2 + 1] = currentPoint + 1 
					indices[currentIndex2 + 2] = currentPoint + width
					indices[currentIndex2 + 3] = currentPoint + width
					indices[currentIndex2 + 4] = currentPoint + width + 1
					indices[currentIndex2 + 5] = currentPoint + 1

				vertices[currentIndex + 0] = x
				vertices[currentIndex + 1] = y
				vertices[currentIndex + 2] = zOffset

				currentPoint++
				currentIndex += 3

		callback(null, vertices, indices) if callback

# This loads and caches a pair (vertex and fragment) shaders
#
# **Mixins**: Model.Cacheable
# **Mixins**: Model.Synchronizable
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
_.extend Model.Mesh, Model.Cacheable
_.extend Model.Shader, Model.Synchronizable
_.extend Model.Shader, Model.Cacheable
