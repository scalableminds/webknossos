### define
model : Model
libs/gl_engine/geometry_mesh : Mesh
libs/gl_engine/geometry_trianglesplane : Trianglesplane
view : View
###

GeometryFactory =

	createMesh : (fileName, shaderName, modelName) ->
		$.when(
			Model.Shader.get(shaderName),
			Model.Mesh.get(fileName)
		).pipe (shader, geometry) =>
			mesh = new Mesh shader.vertexShader, shader.fragmentShader
			if modelName? then mesh.setName modelName else mesh.setName fileName
			mesh.setVertices(
				View.createArrayBufferObject( geometry.vertices ),
				geometry.vertices.length
			)
			mesh.setColors(
				View.createArrayBufferObject( geometry.colors ),
				geometry.colors.length
			)
			mesh.setVertexIndex (View.createElementArrayBufferObject geometry.indices), geometry.indices.length
			mesh.setNormals (View.createArrayBufferObject geometry.normals), geometry.normals.length

			return mesh

	createTrianglesplane : (width, zOffset, shaderName) ->
		$.when(
			Model.Shader.get(shaderName),
			Model.Trianglesplane.get(width, zOffset)	
		).pipe (shader, geometry) ->
			trianglesplane = new Trianglesplane shader.vertexShader, shader.fragmentShader
			trianglesplane.setNormalVertices geometry.normalVertices
			trianglesplane.setQueryVertices geometry.queryVertices
			trianglesplane.setVertexIndex (View.createElementArrayBufferObject geometry.indices), geometry.indices.length
			return trianglesplane
