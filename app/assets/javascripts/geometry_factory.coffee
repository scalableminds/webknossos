class _GeometryFactory 


	createMesh : (modelName, shaderName) ->
		$.when(
			getShader(shaderName),
			getMesh(modelName)
		).pipe (shader, geometry) ->
			mesh = new Mesh shader.vertexShader, shader.fragmentShader
			mesh.setName modelName
			mesh.setVertices (View.createArrayBufferObject geometry.vertices), geometry.vertices.length
			mesh.setColors (View.createArrayBufferObject geometry.colors), geometry.colors.length
			mesh.setVertexIndex (View.createElementArrayBufferObject geometry.indices), geometry.indices.length
			return mesh

	createTrianglesplane : (width, zOffset, shaderName) ->
		$.when(
			getShader(shaderName),
			getTrianglesPlane(width, zOffset)	
		).pipe (shader, geometry) ->
			trianglesplane = new Trianglesplane shader.vertexShader, shader.fragmentShader
			trianglesplane.setNormalVertices geometry.vertices, geometry.width
			trianglesplane.setVertexIndex (View.createElementArrayBufferObject geometry.indices), geometry.indices.length
			return trianglesplane
		

	getShader = (shaderName) ->
		deferred = $.Deferred()
		Model.Shader.get(shaderName, (err, vertexShader, fragmentShader) ->
			if err
				deferred.reject(err)
			else
				deferred.resolve { vertexShader, fragmentShader }
		)
		deferred.promise()

	getMesh = (modelName) ->
		deferred = $.Deferred()
		Model.Mesh.get(modelName, (err, vertices, colors, indices) ->
			if err
				deferred.reject(err)
			else
				deferred.resolve { vertices, colors, indices }
		)
		deferred.promise()

	getTrianglesPlane = (width, zOffset) ->
		deferred = $.Deferred()
		Model.Trianglesplane.get(width, zOffset, (err, vertices, indices) ->
			if err
				deferred.reject(err)
			else
				deferred.resolve {vertices, indices}
		)	
		deferred.promise()
				
GeometryFactory = new _GeometryFactory
