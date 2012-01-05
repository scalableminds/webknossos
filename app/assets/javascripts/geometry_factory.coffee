class _GeometryFactory 

	#load the binary pointcloud data & a shader from the Model
	loadPointcloud : (postion, direction, shaderName) ->
		fragmentShaderSource = null
		vertexShaderSource = null
		tmpVertices = null
		tmpColors = null

		Model.Shader.get(shaderName, (err, vertexShader, fragmentShader) =>
			unless err
				fragmentShaderSource = fragmentShader
				vertexShaderSource = vertexShader

				if tmpVertices? and tmpColors? 
					@createPointcloud(tmpVertices, tmpColors,
					fragmentShaderSource, vertexShaderSource)
		)

		Model.Binary.get(postion,direction,(err,vertices, colors) =>
			unless err
				tmpVertices = vertices
				tmpColors = colors

				if fragmentShaderSource? and vertexShaderSource?
					View.addColors tmpColors, 0, 0
					#@createPointcloud(tmpVertices, tmpColors, 
					#fragmentShaderSource, vertexShaderSource)
			else
				console.log err
		)

		Model.Trianglesplane.get(128,(err, vertices, indices) =>
			unless err
				if fragmentShaderSource? and vertexShaderSource?
					@createTrianglesplane(vertices, indices, 
					fragmentShaderSource, vertexShaderSource)
			else
				console.log err
		)

	# create a new Pointcloud object and send it to the View
	createPointcloud : (vertices, colors, fragmentShader, vertexShader) ->
		
			pointCloud = new Pointcloud fragmentShader, vertexShader
			pointCloud.setVertices (View.createArrayBufferObject vertices), vertices.length
			pointCloud.setColors (View.createArrayBufferObject colors), colors.length
			View.addGeometry pointCloud

	createMesh : (vertices, RGB_colors, indices) ->
			mesh = new Mesh FragmentShaderSource, VertexShaderSource
			mesh.setVertices (View.createArrayBufferObject vertices), vertices.length
			mesh.setColors (View.createArrayBufferObject RGB_colors), RGB_colors.length
			mesh.setVertexIndex (View.createIndexArrayBufferObject indices), indices.length
			View.addGeometry mesh

	createTrianglesplane : (vertices, indices, fragmentShader, vertexShader) ->
			trianglesplane = new Mesh fragmentShader, vertexShader
			trianglesplane.normalVertices = vertices
			trianglesplane.setVertexIndex (View.createIndexArrayBufferObject indices), indices.length
			View.addGeometry trianglesplane




GeometryFactory = new _GeometryFactory
