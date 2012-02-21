# This is a worker for `Model.Binary`.
# It can do the calculation of vertices accompaning color data
# responded from the server on a `pull` request.
# First the worker loads a model of the response data represented
# as a convex polyhedron. Then for each invocation that model is
# transformed by a transformation matrix and rasterized, resulting
# the requested vertices.

# Loading script dependencies
importScripts(
	"underscore-min.js", 
	"libs/deferreds.js", 
	"libs/mjs.js", 
	"core_ext.js", 
	"binary_request.js"
)

# Constants
EPSILON = 1e-10

# Variables (global)
polygonsPrototype     = null
cubeVerticesPrototype = null
initializeDeferred    = null


# Represents a polygon.
class Polygon

	# Pass an array consisting of three-value arrays, each representing a
	# vertex, or just a flat array where each three values represent a vertex.
	# If you choose the second option you should set `isFlatArray` to `true`. 
	# Make sure the vertices are correctly ordered in counter-clockwise manner.
	# Otherwise the polygon's normal cannot be calculated correctly.
	#
	# The constructor turns the vertices list into a typed array and precomputes
	# the Hesse normal form.
	constructor : (vertices, isFlatArray) ->
		unless isFlatArray or not _.isArray(vertices[0])
			@vertices = _vertices = new Float64Array(vertices.length * 3)
			i = j = 0
			while i < vertices.length
				vertex = vertices[i++]
				_vertices[j++] = vertex[0]
				_vertices[j++] = vertex[1]
				_vertices[j++] = vertex[2]
		
			@normal = V3.cross(
				V3.sub(vertices[0], vertices[1], new Float64Array(3)), 
				V3.sub(vertices[2], vertices[1], new Float64Array(3)), 
				new Float64Array(3)
			)
			
			@d = V3.dot(vertices[0], @normal)
		
		else
			@vertices = vertices

			vec1 = new Float64Array(3)
			vec1[0] = vertices[0]
			vec1[1] = vertices[1]
			vec1[2] = vertices[2]

			vec2 = new Float64Array(3)
			vec2[0] = vertices[3]
			vec2[1] = vertices[4]
			vec2[2] = vertices[5]

			vec3 = new Float64Array(3)
			vec3[0] = vertices[6]
			vec3[1] = vertices[7]
			vec3[2] = vertices[8]

			@normal = V3.cross(
				V3.sub(vec1, vec2, new Float64Array(3)), 
				V3.sub(vec3, vec2, new Float64Array(3)), 
				new Float64Array(3)
			)

			@d = V3.dot(vec3, @normal)

	# Transform the polygon using a transformation matrix.
	transform : (matrix) ->
		new Polygon(
			M4x4.transformPointsAffine(matrix, @vertices, new Float64Array(@vertices.length)),
			true
		)

	# Tests whether a point lies inside of the associated
	# polyhedron.
	isInside : (point, polygons) ->
		for polygon in polygons when polygon != @
			if V3.dot(polygon.normal, point) - polygon.d > EPSILON
				return false
		true


initialize = ->
	
	unless initializeDeferred
		initializeDeferred = $.Deferred()
		
		initializeDeferred.fail ->
			initializeDeferred = null

		request(url : '/binary/polygons/cube')
			.done((data) ->
				
				data = JSON.parse(data)
				
				polygonsPrototype = []
				for face in data
					polygonsPrototype.push(new Polygon(face))

				cubeVerticesPrototype = []
				for face in data
					for vertex in face
						alreadyListed = false
						for i in [0...cubeVerticesPrototype.length] by 3
							if cubeVerticesPrototype[i] == vertex[0] and cubeVerticesPrototype[i + 1] == vertex[1] and cubeVerticesPrototype[i + 2] == vertex[2]
								alreadyListed = true
								break
						cubeVerticesPrototype.push(vertex[0], vertex[1], vertex[2]) unless alreadyListed

				cubeVerticesPrototype = new Float64Array(cubeVerticesPrototype)
								
				initializeDeferred.resolve()

			).fail((err) -> initializeDeferred.reject(err))

	initializeDeferred.promise()


self.onmessage = (event) ->
	
	initialize().done ->

		args = event.data
		workerHandle = args.workerHandle
		
		cubeVertices = M4x4.transformPointsAffine(
			args.matrix, 
			cubeVerticesPrototype, 
			new Float64Array(cubeVerticesPrototype.length)
		)
		
		polygons = []
		for polygon in polygonsPrototype
			polygons.push(polygon.transform(args.matrix))
		
		max_x = min_x = cubeVertices[0] | 0
		max_y = min_y = cubeVertices[1] | 0
		max_z = min_z = cubeVertices[2] | 0
		for i in [3...cubeVertices.length] by 3
			x = cubeVertices[i]
			y = cubeVertices[i + 1]
			z = cubeVertices[i + 2]
			x = (x + if x >= 0 then EPSILON else -EPSILON) | 0
			y = (y + if y >= 0 then EPSILON else -EPSILON) | 0
			z = (z + if z >= 0 then EPSILON else -EPSILON) | 0
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


		v001 = new Float64Array(3)
		v001[2] = 1

		polygons1 = []
		for polygon in polygons
			divisor = V3.dot(v001, polygon.normal)
			unless -EPSILON <= divisor <= EPSILON
				polygon.divisor = divisor
				polygons1.push(polygon)

		vxy0 = new Float64Array(3)
		vxyz = new Float64Array(3)
		vertices = []
		for x in [min_x..max_x]
			vxy0[0] = x
			vxyz[0] = x

			for y in [min_y..max_y]  
				vxy0[1] = y
				vxyz[1] = y

				start_z = end_z = null
				for polygon in polygons1
					z = ((polygon.d - V3.dot(vxy0, polygon.normal)) / polygon.divisor)
					vxyz[2] = z
					
					if polygon.isInside(vxyz, polygons)
						z = (z + if z >= 0 then EPSILON else -EPSILON) | 0

						unless start_z?
							start_z = end_z = z
						else
							throw "nooo" if start_z != end_z and start_z - EPSILON <= z <= start_z + EPSILON and end_z - EPSILON <= z <= end_z + EPSILON
							start_z = z if z < start_z
							end_z   = z if z > end_z 
				
				if start_z?
					if end_z >= 0
						start_z = 0 if start_z < 0
						
						for z in [start_z..end_z]
							vertices.push x, y, z
						
		vertices = new Float32Array(vertices)
		
		minmax = [
			min_x, min_y, min_z
			max_x, max_y, max_z
		]
						
		postMessage { vertices, minmax, workerHandle }