class _GeometryFactory 

	createMesh : (name, shaderName) ->
		getShader(shaderName, (err, fragmentShader, vertexShader) ->
			unless err
				Model.Mesh.get(name,(err, vertices, colors, indices) ->
					unless err
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

	createTrianglesplane : (width, shaderName) ->
		getShader(shaderName, (err, fragmentShader, vertexShader) ->
			unless err
				Model.Trianglesplane.get(width,(err, vertices, indices) ->
					unless err
						trianglesplane = new Trianglesplane fragmentShader, vertexShader
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
				callback null, fragmentShader, vertexShader
			else
				callback err
		)

GeometryFactory = new _GeometryFactory
