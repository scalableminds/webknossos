importScripts("underscore-min.js", "libs/mjs.js", "core_ext.js", "binary_request.js")

polygonsTemplate  = null
cubeVerticesTemplate = null
EPSILON = 1e-10

class Polygon

	constructor : (vertices) ->
		@vertices = vertices
		@normal = V3.cross(V3.sub(vertices[0], vertices[1]), V3.sub(vertices[2], vertices[1]))
		@d = V3.dot(vertices[0], @normal)

	transform : (matrix) ->
		new Polygon(@vertices.map (a) -> M4x4.transformPointAffine(matrix, a))

	isInside : (point, polygons) ->
		for polygon in polygons when polygon != @
			if V3.dot(polygon.normal, point) - polygon.d > EPSILON
				return false
		true


initializePolygonsTemplate = _.once2 (doneCallback) ->
		
	request
		url : '/binary/polygons/cube'
		(err, data) ->
			
			callback = doneCallback(err)
			
			unless err
				data = JSON.parse(data)
				polygonsTemplate = data.map (face) -> new Polygon(face)
				cubeVerticesTemplate = []
				for face in data
					for vertex in face
						cubeVerticesTemplate.push vertex
				cubeVerticesTemplate = _.uniq(cubeVerticesTemplate, null, (a) -> a.toString())
				callback() if callback
			
			return


self.onmessage = (event) ->
	
	initializePolygonsTemplate (err) ->

		args = event.data
		workerHandle = args.workerHandle
		
		return postMessage({ err, workerHandle }) if err

		cubeVertices = cubeVerticesTemplate.map (a) -> M4x4.transformPointAffine(args.matrix, a)
		polygons     = polygonsTemplate.map (a) -> a.transform(args.matrix)
		
		max_x = min_x = cubeVertices[0][0] | 0
		max_y = min_y = cubeVertices[0][1] | 0
		max_z = min_z = cubeVertices[0][2] | 0
		for i in [1...cubeVertices.length]
			vertex = cubeVertices[i]
			x = vertex[0] | 0
			y = vertex[1] | 0
			z = vertex[2] | 0
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
		minmax = [
			min_x, min_y, min_z
			max_x, max_y, max_z
		]

		vertices = []
		v001 = [0, 0, 1]
		for x in [min_x..max_x]  
			for y in [min_y..max_y]  
				vxy0 = [x,y,0]
				z_range = []
				for polygon in polygons
					normal = polygon.normal
					divisor = V3.dot(v001, normal)
					unless -EPSILON <= divisor <= EPSILON
						z = ((polygon.d - V3.dot(vxy0, normal)) / divisor)
						z = (z + if z > 0 then EPSILON else -EPSILON) | 0

						if polygon.isInside([x,y,z], polygons)
							z_range.push(z) 
				
				if z_range.length > 0
					start_z = _.min(z_range)
					end_z   = _.max(z_range)
					
					if end_z >= 0
						start_z = 0 if start_z < 0

						for z in [start_z..end_z]
							vertices.push x,y,z
		
		vertices = new Float32Array(vertices)


							
		postMessage({ vertices, minmax, workerHandle })