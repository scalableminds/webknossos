# This creates a Triangleplane
# It is essentially a square with a grid of vertices. Those vertices are
# connected through triangles. Cuz that's how u do it in WebGL.
define ->
		
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
			

			# Transforming those vertices to become a spherical cap.
			# http://en.wikipedia.org/wiki/Spherical_cap
			radius = 140
			centerVertex = [0, 0, zOffset - radius]

			i = 0
			vec  = new Float32Array(3)
			vec2 = new Float32Array(3)
			for i in [0...vertices.length] by 3
				vec[0] = vertices[i]
				vec[1] = vertices[i + 1]
				vec[2] = vertices[i + 2]

				vec2 = V3.sub(vec, centerVertex, vec2)
				length = V3.length(vec2)
				vec2 = V3.scale(vec2, radius / length, vec2)
				V3.add(centerVertex, vec2, vec)

				vertices[i]     = vec[0]
				vertices[i + 1] = vec[1]
				vertices[i + 2] = vec[2]



			deferred.resolve { vertices, indices }
		
		deferred.promise()