define [
		"model/binary/interpolation_collector"
		"libs/simple_array_buffer_socket"
		"libs/simple_worker"
		"model/binary/block_preloader"
	], (InterpolationCollector, SimpleArrayBufferSocket, SimpleWorker, BlockPreloader) ->

		pullCounter = 0

		# This is the model. It takes care of the data including the 
		# communication with the server.
		#
		# All public operations are **asynchronous**. We return a promise
		# which you can react on.

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

		# Macros
		bucketIndexMacro = (x, y, z) ->

			((x >> 6) - cubeOffset[0]) + 
			((y >> 6) - cubeOffset[1]) * cubeSize[0] + 
			((z >> 6) - cubeOffset[2]) * cubeSize[0] * cubeSize[1]

		bucketIndex2Macro = (x, y, z) ->

			((x >> 6) - cubeOffset0) + 
			((y >> 6) - cubeOffset1) * cubeSize0 + 
			((z >> 6) - cubeOffset2) * cubeSize01

		pointIndexMacro = (x, y, z) ->
			
			(x & 63) +
			((y & 63) << 6) +
			((z & 63) << 12)

		Binary =
			
			# This method gives you the vertices for a chunk of data (i.e. a cube). 
			# You need to provide the position and rotation of the cube you're looking 
			# for in form of a 4x4 transformation matrix.
			#
			# Imagine you want to load a cube which sits arbitrarily in 3d space i.e. 
			# it has an arbitrary position and arbitrary rotation. Because we have a 
			# template polyhedron it is just a matter of applying the transformation 
			# matrix and rasterizing the polyhedron. Big ups to 
			# [Vladimir Vukićević](http://vlad1.com/) for writing the mjs-js (matrix 
			# javascripat) library.
			#
			# Parameters:
			#
			# *   `matrix` is a 16-element array representing the 4x4 transformation matrix
			# 
			#
			# Promise Parameters:
			#
			# *   `vertices` is a `Float32Array` with the transformed values. Every three
			# elements represent the coordinates of a vertex.
			#
			#


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
			# Promise Parameters:
			# 
			# *   `buffer0` is a `Float32Array` with the first 4 color values of
			# each points. The first value would contain any error codes.
			# *   `buffer1` is a `Float32Array` with the second 4 color values of
			# each points.
			# *   `bufferDelta` is a `Float32Array` with the delta values.
			#
			get : (vertices) ->

				$.when(@getSync(vertices))

			# A synchronized implementation of `get`.
			getSync : (vertices) ->

				buffer0     = new Float32Array(vertices.length / 3 << 2)
				buffer1     = new Float32Array(vertices.length / 3 << 2)
				bufferDelta = new Float32Array(vertices.length)
				
				if (cube = @cube)
					
					{ cubeSize, cubeOffset } = @

					InterpolationCollector.bulkCollect(
						vertices,
						buffer0, buffer1, bufferDelta, 
						cube, cubeSize, cubeOffset
					)
					
				{ buffer0, buffer1, bufferDelta }


			PRELOAD_TEST_TOLERANCE : 0.9
			PRELOAD_TEST_RADIUS : 37
			PING_DEBOUNCE_TIME : 500
			PING_THROTTLE_TIME : 2500
			PRELOAD_STEPBACK : 18
			
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

				# fire if
				# *   wasn't called for PING_DEBOUNCE_TIME or
				# *   PING_THROTTLE_TIME after last call are over
				@ping = _.debounceOrThrottleDeferred(@pingImpl2, @PING_DEBOUNCE_TIME, @PING_THROTTLE_TIME)
				@ping(matrix)


			pingImpl2 : (matrix) ->

				promises        = []
				preloadRadius   = @PRELOAD_TEST_RADIUS
				preloadDiameter = @PRELOAD_TEST_RADIUS << 1
				
				if promise = @preload(matrix, 0, 0, 0, preloadDiameter)
					promises.push(promise)
				else
					for z in [-1...50] by 10
						if promise = @preload(matrix, 0, 0, z, preloadDiameter)
							promises.push(promise)
							break

				$.whenWithProgress(promises...) if promises.length
			

			pingImpl : (matrix) ->

				promises        = []
				preloadRadius   = @PRELOAD_TEST_RADIUS
				preloadDiameter = @PRELOAD_TEST_RADIUS << 1
				
				for x0 in [-preloadRadius..preloadRadius] by preloadDiameter
					for y0 in [-preloadRadius..preloadRadius] by preloadDiameter
						if promise = @preload(matrix, x0, y0, 0, preloadDiameter)
							promises.push(promise)
						else
							for z in [-1...50] by 10
								if promise = @preload(matrix, x0, y0, z, preloadDiameter)
									promises.push(promise)
									break

				$.whenWithProgress(promises...) if promises.length
			
			preload : (matrix, x0, y0, z, width, sparse = 5) ->
				# magic number 5
				matrix = M4x4.translate([x0, y0, z - @PRELOAD_STEPBACK - 5], matrix)
				if @preloadTest(matrix, width, sparse) < @PRELOAD_TEST_TOLERANCE
					@pull(matrix)
				else
					false

			preloadTestVertices : _.memoize(
				(width, sparse) ->
					vertices = []
					halfWidth = width >> 1
					for x in [-halfWidth..halfWidth] by sparse
						for y in [-halfWidth..halfWidth] by sparse
							vertices.push x, y, 5 # magic number 5
					vertices
				(args...) -> args.toString()
			)

			preloadTest : (matrix, width, sparse) ->				

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

				console.log "pull", pullCounter++
				
				$.when(@loadColors(matrix), @calcVertices(matrix))

					.pipe (colors, { vertices, extent }) =>

						# Maybe we need to expand our data structure.
						@extendByExtent(extent)
						
						if vertices.length != colors.length * 3
							console.error("Color (#{colors.length}) and vertices (#{vertices.length / 3}) count doesn't match.", matrix) 

						@bulkSetColor(vertices, colors)

						null
			
			loadColorsSocket : new SimpleArrayBufferSocket(
				defaultSender : new SimpleArrayBufferSocket.WebSocket("ws://#{document.location.host}/binary/ws/cube")
				fallbackSender : new SimpleArrayBufferSocket.XmlHttpRequest("/binary/data/cube")
				requestBufferType : Float32Array
				responseBufferType : Uint8Array
			)
			
			loadColors : (matrix) ->
				
				@loadColorsSocket.send(matrix)

			calcVerticesWorker : new SimpleWorker("/assets/javascripts/calc_vertices_worker.js")

			calcVertices : (matrix) ->

				@calcVerticesWorker.send { matrix }
					
			
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

			BUCKET_WIDTH : 1 << 6

			# Retuns the index of the bucket (in the cuboid) which holds the
			# point you're looking for.
			bucketIndex : (x, y, z) ->
				
				{ cubeOffset, cubeSize } = @

				bucketIndexMacro(x, y, z)
			
			# Returns the index of the point (in the bucket) you're looking for.
			pointIndex : (x, y, z) ->
				
				pointIndexMacro(x, y, z)

			# Want to add data? Make sure the cuboid is big enough.
			# This one is for passing real point coordinates.
			extendByExtent : ({ min_x, min_y, min_z, max_x, max_y, max_z }) ->
				
				@extendByBucketExtent(
					min_x >> 6,
					min_y >> 6,
					min_z >> 6,
					max_x >> 6,
					max_y >> 6,
					max_z >> 6
				)
				
			# And this one is for passing bucket coordinates.
			extendByBucketExtent : (x0, y0, z0, x1, y1, z1) ->

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
					newCubeOffset = new Uint32Array(3)
					newCubeOffset[0] = Math.min(x0, x1)
					newCubeOffset[1] = Math.min(y0, y1)
					newCubeOffset[2] = Math.min(z0, z1)
					
					newCubeSize = new Uint32Array(3)
					newCubeSize[0] = Math.max(x0, x1) - newCubeOffset[0] + 1
					newCubeSize[1] = Math.max(y0, y1) - newCubeOffset[1] + 1
					newCubeSize[2] = Math.max(z0, z1) - newCubeOffset[2] + 1
					
					newCube = []
					newCube.push(null) for xyz in [0...(newCubeSize[0] * newCubeSize[1] * newCubeSize[2])]

					@cube       = newCube
					@cubeOffset = newCubeOffset
					@cubeSize   = newCubeSize


			# Returns a color value from the data structure.
			# Color values range from 1 to 2 -- with black being 0 and white 1.
			getColor : (x, y, z) ->
				
				unless (cube = @cube)
					return 0

				{ cubeOffset, cubeSize } = @

				bucket = cube[bucketIndexMacro(x, y, z)]
				
				if bucket
					bucket[pointIndexMacro(x, y, z)]
				else
					0
			
			# Returns a set of color values from the data structure specified
			# by the passed `vertices`.
			# Unset values (0) are omitted so the indices of the color values
			# may not match the indices of the the vertices.
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
						
						bucketIndex = bucketIndex2Macro(x, y, z)
						
						colors[i++] =
							if bucket = cube[bucketIndex]
								bucket[pointIndexMacro(x, y, z)]
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

				{ cubeOffset, cubeSize } = @

				bucketIndex = bucketIndexMacro(x, y, z)
				bucket      = cube[bucketIndex]

				if 0 <= bucketIndex < cube.length
					unless bucket?
						bucket = cube[bucketIndex] = new Float32Array(1 << 18)
					bucket[pointIndexMacro(x, y, z)] = color
				else
					# Please handle cuboid expansion explicitly.
					throw "cube fault"
			
			# Stores a set of color values in the data structure.
			# You need to pass both the `vertices` and `colors`.
			# Before invoking this method you have to make sure the
			# data structure is large enough to handle your input
			# data. Use `extendByExtent`.
			# Also, you can choose to just have a chunk of the data
			# stored. Then you'll also need to specify `offset` and
			# `length`.
			bulkSetColor : (vertices, colors, offset = 0, length) ->
				
				{ cube, cubeOffset, cubeSize } = @
				cubeOffset0 = cubeOffset[0]
				cubeOffset1 = cubeOffset[1]
				cubeOffset2 = cubeOffset[2]
				cubeSize0   = cubeSize[0]
				cubeSize01  = cubeSize[0] * cubeSize[1]


				endIndex = if length? and offset + length < colors.length
					offset + length
				else
					colors.length
				
				x0 = vertices[offset]
				y0 = vertices[offset + 1]
				z0 = vertices[offset + 2]
				
				bucketIndex = bucketIndex2Macro(x0, y0, z0)
				pointIndex  = pointIndexMacro(x0, y0, z0)
				bucket      = cube[bucketIndex]

				i = offset
				j = offset * 3

				while i < endIndex

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
						bucketIndex = bucketIndex2Macro(x, y, z)
						pointIndex  = pointIndexMacro(x, y, z)
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
		#_.extend(Binary, BlockPreloader)