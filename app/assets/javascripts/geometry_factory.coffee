class _GeometryFactory 

	createMesh : (name, shaderName) ->
		getShader(shaderName, (err, vertexShader, fragmentShader) ->
			unless err
				Model.Mesh.get(name,(err, vertices, colors, indices) ->
					unless err
						mesh = new Mesh vertexShader, fragmentShader
						mesh.setVertices (View.createArrayBufferObject vertices), vertices.length
						mesh.setColors (View.createArrayBufferObject colors), colors.length
						mesh.setVertexIndex (View.createElementArrayBufferObject indices), indices.length

						View.addGeometry mesh
					else
						throw err
				)
			else
				throw err
		)

	createTrianglesplane : (width, zOffset, shaderName) ->
		getShader(shaderName, (err, vertexShader, fragmentShader) ->
			unless err
				Model.Trianglesplane.get(width, zOffset,(err, vertices, indices) ->
					unless err
						trianglesplane = new Trianglesplane vertexShader, fragmentShader
						trianglesplane.setNormalVertices vertices, width
						trianglesplane.setVertexIndex (View.createElementArrayBufferObject indices), indices.length

						View.addGeometry trianglesplane
					else
						throw err
				)
			else
				throw err
		)


	getShader = (shaderName, callback) ->
		Model.Shader.get(shaderName, (err, vertexShader, fragmentShader) ->
			unless err
				callback null, vertexShader, fragmentShader
			else
				callback err
		)

GeometryFactory = new _GeometryFactory
