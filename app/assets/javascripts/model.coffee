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
	calcVerticesWorker : new SimpleWorker("/assets/javascripts/pullVerticesWorker.js")

	calcVertices : (matrix) ->

		@calcVerticesWorker.send { matrix }


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
	get : (vertices) ->

		$.Deferred()
			.resolve(@getSync(vertices))
			.promise()


	getSync : (vertices) ->

		bufferFront = new Float32Array(vertices.length / 3 << 2)
		bufferBack  = new Float32Array(vertices.length / 3 << 2)
		bufferDelta = new Float32Array(vertices.length)
		
		if (cube = @cube)
			
			{ cubeSize, cubeOffset } = @
			size0  = cubeSize[0]
			size01 = cubeSize[0] * cubeSize[1]
			
			lowerBound0 = cubeOffset[0] << 6
			lowerBound1 = cubeOffset[1] << 6
			lowerBound2 = cubeOffset[2] << 6
			upperBound0 = (cubeOffset[0] + cubeSize[0]) << 6
			upperBound1 = (cubeOffset[1] + cubeSize[1]) << 6
			upperBound2 = (cubeOffset[2] + cubeSize[2]) << 6

			InterpolationCollector.bulkCollect(
				vertices,
				bufferFront, bufferBack, bufferDelta, 
				cube, 
				lowerBound0, lowerBound1, lowerBound2,
				upperBound0, upperBound1, upperBound2,
				size0, size01
			)
			
		{ bufferFront, bufferBack, bufferDelta }


	PRELOAD_TEST_TOLERANCE : 0.9
	PRELOAD_TEST_RADIUS : 37
	PING_THROTTLE_TIME : 3000
	COMPARE_TOLERANCE_ANGLE_COSINE : .99
	COMPARE_TOLERANCE_TRANSLATION : 30

	loadingMatrices : []
	lastPing : null
	
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
	ping : (matrix) ->

		if (lastPing = @lastPing) and (new Date() - lastPing.time) < @PING_THROTTLE_TIME and @compareMatrix(lastPing.matrix, matrix)
			null
		else
			time = new Date()
			@lastPing = { matrix, time }
			deferred = @pingImpl(matrix)
			deferred.fail => @lastPingedMatrix = null
			deferred

	pingImpl : (matrix) ->

		promises        = []
		preloadRadius   = @PRELOAD_TEST_RADIUS
		preloadDiameter = @PRELOAD_TEST_RADIUS << 1
		
		for x0 in [-preloadRadius..preloadRadius] by preloadDiameter
			for y0 in [-preloadRadius..preloadRadius] by preloadDiameter
				if promise = @preload(matrix, x0, y0, 0, preloadDiameter)
					promises.push(promise)
				else
					for z in [-1...15] by 3
						if promise = @preload(matrix, x0, y0, z, preloadDiameter)
							promises.push(promise)
							break

		$.whenWithProgress(promises...)

	compareMatrix : (matrix1, matrix2) ->

		vec1 = new Float64Array(3)
		vec2 = new Float64Array(3)
		
		for i in [0..2]
			cardinalVector = [0, 0, 0]
			cardinalVector[i] = 1

			transformedCardinalVector1 = V3.normalize(M4x4.transformLineAffine(matrix1, cardinalVector, vec1), vec1)
			transformedCardinalVector2 = V3.normalize(M4x4.transformLineAffine(matrix2, cardinalVector, vec2), vec2)

			return false if V3.dot(transformedCardinalVector1, transformedCardinalVector2) < @COMPARE_TOLERANCE_ANGLE_COSINE
		
		position1 = [matrix1[12], matrix1[13], matrix1[14]]
		position2 = [matrix2[12], matrix2[13], matrix2[14]]

		return V3.length(V3.sub(position1, position2, vec1)) < @COMPARE_TOLERANCE_TRANSLATION
	
	preload : (matrix, x0, y0, z, width, sparse = 5) ->
		
		matrix = M4x4.translate([x0, y0, z - 5], matrix)
		if @preloadTest(matrix, width, sparse) < @PRELOAD_TEST_TOLERANCE
			@pull(matrix)
		else
			false

	preloadTestVertices : (width, sparse) ->
		@preloadTestVertices = _.memoize(@preloadTestVerticesImpl, (args...) -> args.toString())
		@preloadTestVertices(width, sparse)

	preloadTestVerticesImpl : (width, sparse) ->
		vertices = []
		halfWidth = width >> 1
		for x in [-halfWidth..halfWidth] by sparse
			for y in [-halfWidth..halfWidth] by sparse
				vertices.push x, y, 0
		vertices

	preloadTest : (matrix, width, sparse) ->

		return 1 if _.any(@loadingMatrices, (a) => @compareMatrix(matrix, a))

		vertices = M4x4.transformPointsAffine(matrix, @preloadTestVertices(width, sparse))

		i = j = 0
		while j < vertices.length
			x = vertices[j++]
			y = vertices[j++]
			z = vertices[j++]
			
			if x >= 0 and y >= 0 and z >= 0
				if i != j
					vertices[i++] = x
					vertices[i++] = y
					vertices[i++] = z

		count = i / 3
		colors = @bulkGetColorUnordered(vertices.subarray(0, i))
		
		hits = 0

		for color in colors
			hits++  if color > 0
		
		hits / count


	pull : (matrix) ->

		CHUNK_SIZE = 1e5

		@loadingMatrices.push(matrix)
		
		$.when(@loadColors(matrix), @calcVertices(matrix))

			.pipe (colors, { vertices, minmax }) =>

				# Maybe we need to expand our data structure.
				@extendPoints(minmax...)
				
				console.error("Color (#{colors.length}) and vertices (#{vertices.length / 3}) count doesn't match.", matrix) if vertices.length != colors.length * 3

				deferred = $.Deferred()

				# Then we'll just put the point in to our data structure.
				i = 0

				# calcChunk = => 
				# 	_.defer( =>
				# 		try
				# 			i = @bulkSetColor(vertices, colors, i, CHUNK_SIZE)
				# 		catch err
				# 			console.error minmax
				# 			throw err
								
				# 		if i == colors.length
				# 			_.removeElement(@loadingMatrices, matrix)
				# 			deferred.resolve()
				# 		else
				# 			calcChunk()
				# 	)
					
				# calcChunk()

				@bulkSetColor(vertices, colors)
				_.removeElement(@loadingMatrices, matrix)
				deferred.resolve()
			
				deferred.promise()

	
	loadColorsSocket : new SimpleArrayBufferSocket(
		url : "ws://#{document.location.host}/binary/ws/cube"
		fallbackUrl : "/binary/data/cube"
		requestBufferType : Float32Array
		responseBufferType : Uint8Array
	)
	
	loadColors : (matrix) ->
		
		@loadColorsSocket.send(matrix)
			
	
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
		
		{ cubeOffset, cubeSize } = @

		# `(x / 64) - offset.x + 
		# ((y / 64) - offset.y) * size.x + 
		# ((z / 64) - offset.z) * size.x * size.y`
		((x >> 6) - cubeOffset[0]) + 
		((y >> 6) - cubeOffset[1]) * cubeSize[0] + 
		((z >> 6) - cubeOffset[2]) * cubeSize[0] * cubeSize[1]
	
	# Returns the index of the point (in the bucket) you're looking for.
	pointIndex : (x, y, z) ->
		
		# `x % 64 + (y % 64) * 64 + (z % 64) * 64^2
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
		throw "noooo" if @bucketIndex(x_max, y_max, z_max) > @cube.length
	
	# And this one is for passing bucket coordinates.
	extendCube : (x0, y0, z0, x1, y1, z1) ->

		oldCube       = @cube
		oldCubeOffset = @cubeOffset
		oldCubeSize   = @cubeSize		

		# First, we calculate the new dimension of the cuboid.
		if oldCube?
			upperBound = new Uint32Array(3)
			upperBound[0] = oldCubeOffset[0] + oldCubeSize[0]
			upperBound[1] = oldCubeOffset[1] + oldCubeSize[1]
			upperBound[2] = oldCubeOffset[2] + oldCubeSize[2]
			

			newCubeOffset = new Uint32Array(3)
			newCubeOffset[0] = Math.min(x0, x1, oldCubeOffset[0])
			newCubeOffset[1] = Math.min(y0, y1, oldCubeOffset[1])
			newCubeOffset[2] = Math.min(z0, z1, oldCubeOffset[2])
			
			newCubeSize = new Uint32Array(3)
			newCubeSize[0] = Math.max(x0, x1, upperBound[0] - 1) - newCubeOffset[0] + 1
			newCubeSize[1] = Math.max(y0, y1, upperBound[1] - 1) - newCubeOffset[1] + 1
			newCubeSize[2] = Math.max(z0, z1, upperBound[2] - 1) - newCubeOffset[2] + 1
			

			# Just reorganize the existing buckets when the cube dimensions 
			# have changed.
			if newCubeOffset[0] != oldCubeOffset[0] or 
			newCubeOffset[1] != oldCubeOffset[1] or 
			newCubeOffset[2] != oldCubeOffset[2] or 
			newCubeSize[0] != oldCubeSize[0] or 
			newCubeSize[1] != oldCubeSize[1] or 
			newCubeSize[2] != oldCubeSize[2]

				newCube = []

				for z in [0...newCubeSize[2]]

					# Bound checking is necessary.
					if oldCubeOffset[2] <= z + newCubeOffset[2] < upperBound[2]

						for y in [0...newCubeSize[1]]

							if oldCubeOffset[1] <= y + newCubeOffset[1] < upperBound[1]

								for x in [0...newCubeSize[0]]

									newCube.push if oldCube? and oldCubeOffset[0] <= x + newCubeOffset[0] < upperBound[0]
										index = 
											(x + newCubeOffset[0] - oldCubeOffset[0]) +
											(y + newCubeOffset[1] - oldCubeOffset[1]) * oldCubeSize[0] +
											(z + newCubeOffset[2] - oldCubeOffset[2]) * oldCubeSize[0] * oldCubeSize[1]
										oldCube[index]
									else
										null
							else
								newCube.push(null) for x in [0...newCubeSize[0]]

					else
						newCube.push(null) for xy in [0...(newCubeSize[0] * newCubeSize[1])]

				@cube       = newCube
				@cubeOffset = newCubeOffset
				@cubeSize   = newCubeSize


		else
			# Before, there wasn't any cube.
			newCubeOffset = new Uint16Array(3)
			newCubeOffset[0] = Math.min(x0, x1)
			newCubeOffset[1] = Math.min(y0, y1)
			newCubeOffset[2] = Math.min(z0, z1)
			
			newCubeSize = new Uint16Array(3)
			newCubeSize[0] = Math.max(x0, x1) - newCubeOffset[0] + 1
			newCubeSize[1] = Math.max(y0, y1) - newCubeOffset[1] + 1
			newCubeSize[2] = Math.max(z0, z1) - newCubeOffset[2] + 1
			
			newCube = []
			newCube.push(null) for xyz in [0...(newCubeSize[0] * newCubeSize[1] * newCubeSize[2])]

			@cube       = newCube
			@cubeOffset = newCubeOffset
			@cubeSize   = newCubeSize


	# Getting a color value from the data structure.
	# Color values range from 1 to 2 -- with black being 0 and white 1.
	getColor : (x, y, z) ->
		
		unless (cube = @cube)
			return 0
		
		if (bucket = cube[@bucketIndex(x, y, z)])
			bucket[@pointIndex(x, y, z)]
		else
			0
	
	bulkGetColorUnordered : (vertices) ->

		if cube = @cube
			{ cubeOffset, cubeSize } = @
			cubeOffset0 = cubeOffset[0]
			cubeOffset1 = cubeOffset[1]
			cubeOffset2 = cubeOffset[2]
			cubeSize0   = cubeSize[0]
			cubeSize01  = cubeSize[0] * cubeSize[1]

			colors = new Float32Array(vertices.length / 3)
			i = j = 0
			while j < vertices.length
				x = vertices[j++]
				y = vertices[j++]
				z = vertices[j++]
				
				bucketIndex = 
					((x >> 6) - cubeOffset0) + 
					((y >> 6) - cubeOffset1) * cubeSize0 + 
					((z >> 6) - cubeOffset2) * cubeSize01
				
				colors[i++] =
					if bucket = cube[bucketIndex]
						bucket[@pointIndex(x, y, z)]
					else 
						0

			colors.subarray(0, i)

		else
			[]


	# Set a color value of a point.
	# Color values range from 1 to 2 -- with black being 0 and white 1.
	setColor : (x, y, z, color) ->

		cube = @cube

		throw "cube fault" unless cube?

		bucketIndex = @bucketIndex(x, y, z)
		bucket      = _ube[bucketIndex]

		if 0 <= bucketIndex < cube.length
			unless bucket?
				bucket = cube[bucketIndex] = new Float32Array(1 << 18)
			bucket[@pointIndex(x, y, z)] = color
		else
			# Please handle cuboid expansion explicitly.
			throw "cube fault"
	
	bulkSetColor : (vertices, colors, offset = 0, length) ->
		
		{ cube, cubeOffset, cubeSize } = @
		cubeOffset0 = cubeOffset[0]
		cubeOffset1 = cubeOffset[1]
		cubeOffset2 = cubeOffset[2]
		cubeSize0   = cubeSize[0]
		cubeSize01  = cubeSize[0] * cubeSize[1]


		end = if length? and offset + length < colors.length
			offset + length
		else
			colors.length
		
		x0 = vertices[offset]
		y0 = vertices[offset + 1]
		z0 = vertices[offset + 2]
		
		bucketIndex = @bucketIndex(x0, y0, z0)
		pointIndex  = @pointIndex(x0, y0, z0)
		bucket      = cube[bucketIndex]

		i = offset
		j = offset * 3

		while i < end

			x = vertices[j]
			y = vertices[j + 1]
			z = vertices[j + 2]

			if z == z0 + 1 && y == y0 && x == x0
				if (pointIndex & 258048) == 258048
					# The point seems to be at the back border.
					bucketIndex += cubeSize01
					pointIndex  &= -258049
					bucket      = cube[bucketIndex]
				else
					pointIndex += 4096
			else 
				# Fastcall
				bucketIndex = 
					((x >> 6) - cubeOffset0) + 
					((y >> 6) - cubeOffset1) * cubeSize0 + 
					((z >> 6) - cubeOffset2) * cubeSize01
				
				pointIndex  = @pointIndex(x, y, z)
				bucket      = cube[bucketIndex]
			
			if 0 <= bucketIndex < cube.length
				unless bucket?
					bucket = cube[bucketIndex] = new Float32Array(1 << 18)
				bucket[pointIndex] = colors[i] / 256 + 1
			else
				console.error(x, y, z, bucketIndex, pointIndex)
				throw "cube fault"
			

			x0 = x
			y0 = y
			z0 = z

			i += 1
			j += 3


		i

# This loads and caches meshes.
Model.Mesh =
	
	get : (name) ->

		request(
			url : "/assets/mesh/#{name}"
			responseType : 'arraybuffer'
		).pipe (data) ->
			
				# To save bandwidth meshes are transferred in a binary format.
				header  = new Uint32Array(data, 0, 3)
				vertices = new Float32Array(data, 12, header[0])
				colors   = new Float32Array(data, 12 + header[0] * 4, header[1])
				indices  = new Uint16Array(data, 12 + 4 * (header[0] + header[1]), header[2])

				{ vertices, colors, indices }

Model.Mesh.get = _.memoize(Model.Mesh.get)

# This creates a Triangleplane
# It is essentially a square with a grid of vertices. Those vertices are
# connected through triangles. Cuz that's how u do it in WebGL.
Model.Trianglesplane =
	
	get : (width, zOffset) ->
		
		deferred = $.Deferred()

		_.defer ->
			
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
			
			radius = 100
			middle = [0, 0, zOffset - radius]

			i = 0
			vec  = new Float32Array(3)
			vec2 = new Float32Array(3)
			for i in [0...vertices.length] by 3
				vec[0] = vertices[i]
				vec[1] = vertices[i + 1]
				vec[2] = vertices[i + 2]

				vec2 = V3.sub(vec, middle, vec2)
				length = V3.length(vec2)
				vec2 = V3.scale(vec2, radius / length, vec2)
				V3.add(middle, vec2, vec)

				vertices[i]     = vec[0]
				vertices[i + 1] = vec[1]
				vertices[i + 2] = vec[2]



			deferred.resolve { vertices, indices }
		
		deferred.promise()

# This loads and caches a pair (vertex and fragment) shaders
Model.Shader =

	get : (name) ->

		$.when(
			request(url : "/assets/shader/#{name}.vs"), 
			request(url : "/assets/shader/#{name}.fs")
		).pipe (vertexShader, fragmentShader) -> { vertexShader, fragmentShader }

Model.Shader.get = _.memoize(Model.Shader.get)

# This takes care of the route. 
Model.Route =
	
	dirtyBuffer : []
	route : null
	id : null
	initializeDeferred : null

	# Returns a `position` and `direction` to start your work.
	initialize : ->

		unless @initializeDeferred
			
			@initializeDeferred = $.Deferred()

			@initializeDeferred.fail =>
				@initializeDeferred = null

			request(url : '/route/initialize').done( 
				(data) =>
					try
						data = JSON.parse data

						@route          = [ M4x4.extractTranslation(data.matrix) ]
						@id             = data.id
						
						@initializeDeferred.resolve(data.matrix)
					catch ex
						@initializeDeferred.reject(ex)
			)
		
		@initializeDeferred.promise()
	
	# Pulls a route from the server.
	pull : ->
		request	url : "/route/#{@id}", (err, data) =>
			unless err
				@route = JSON.parse data

	
	# Pushes th buffered route to the server. Pushing happens at most 
	# every 30 seconds.
	push : ->
		@push = _.throttle2(_.mutexDeferred(@_push, -1), 30000)
		@push()

	_push : ->

		deferred = $.Deferred()
		
		@initializeDeferred.done =>
			
			transportBuffer = @dirtyBuffer
			@dirtyBuffer = []

			request(
				url : "/route/#{@id}"
				contentType : 'application/json'
				method : 'POST'
				data : transportBuffer
			).fail( =>
				@dirtyBuffer = transportBuffer.concat(@dirtyBuffer)
				@push()
			).always(-> deferred.resolve())
		
		deferred.promise()

	
	# Add a point to the buffer. Just keep adding them.
	put : (position, callback) ->
		
		@initializeDeferred.done =>
			
			position = [Math.round(position[0]), Math.round(position[1]), Math.round(position[2])]
			_lastPosition = _.last(@route)
			unless _lastPosition[0] == position[0] and _lastPosition[1] == position[1] and _lastPosition[2] == position[2]
				@route.push position
				@dirtyBuffer.push position
				@push()
