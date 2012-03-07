define [
		"model",
		"libs/gl_engine/geometry_mesh",
		"libs/gl_engine/geometry_trianglesplane"
		"view"
	], (Model, Mesh, Trianglesplane, View) ->

		GeometryFactory =

			createMesh : (modelName, shaderName) ->
				$.when(
					Model.Shader.get(shaderName),
					Model.Mesh.get(modelName)
				).pipe (shader, geometry) ->
					mesh = new Mesh shader.vertexShader, shader.fragmentShader
					mesh.setName modelName
					mesh.setVertices (View.createArrayBufferObject geometry.vertices), geometry.vertices.length
					mesh.setColors (View.createArrayBufferObject geometry.colors), geometry.colors.length
					mesh.setVertexIndex (View.createElementArrayBufferObject geometry.indices), geometry.indices.length
					return mesh

			createTrianglesplane : (width, zOffset, shaderName) ->
				$.when(
					Model.Shader.get(shaderName),
					Model.Trianglesplane.get(width, zOffset)	
				).pipe (shader, geometry) ->
					trianglesplane = new Trianglesplane shader.vertexShader, shader.fragmentShader
					trianglesplane.setNormalVertices geometry.vertices, geometry.width
					trianglesplane.setVertexIndex (View.createElementArrayBufferObject geometry.indices), geometry.indices.length
					return trianglesplane
