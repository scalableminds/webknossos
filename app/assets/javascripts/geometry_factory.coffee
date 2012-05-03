### define
model : Model
view : View
###

GeometryFactory =


	createMesh : (fileName, x = 0, y = 0, z = 0) ->
		#parameter showStatus = true
		@binLoader ?= new THREE.JSONLoader()

		@binLoader.load "assets/mesh/" + fileName, (geometry) ->
			mesh = new THREE.Mesh( geometry, new THREE.MeshFaceMaterial() )
			mesh.position.x = x
			mesh.position.y = y
			mesh.position.z = z
			mesh.doubleSided = true
			View.addGeometry mesh


	createTrianglesplane : (width, zOffset) ->
		$.when(
			Model.Shader.get("trianglesplane")
			Model.Trianglesplane.get(width, zOffset)	
		).pipe (shader, geometry) ->
			temp = new THREE.Geometry()

			for i in [0..geometry.normalVertices.length - 1] by 3
				x = geometry.normalVertices[i]
				y = geometry.normalVertices[i + 1]
				z = geometry.normalVertices[i + 2]
				temp.vertices.push new THREE.Vector3(x,y,z)

			

			for i in [0..geometry.indices.length - 1] by 3
				x = geometry.indices[i]
				y = geometry.indices[i + 1]
				z = geometry.indices[i + 2]

				# for some reason every second face is flipped
				if i % 6 == 0
					temp.faces.push new THREE.Face3(x,y,z)
				else
					temp.faces.push new THREE.Face3(z, y, x)

			
			#temp.computeFaceNormals()
			#temp.computeCentroids()
			temp.dynamic = true #FUCKING IMPORTANT

			attributes =
				interpolationBuffer0 :
					type : "v4",
					value : []
				interpolationBuffer1 :
					type : "v4",
					value : []
				interpolationBufferDelta :
					type : "v3",
					value : []

			shaderMaterial = new THREE.ShaderMaterial(
					attributes : attributes,
					vertexShader : shader.vertexShader,
					fragmentShader : shader.fragmentShader,
				)


			trianglesplane = new THREE.Mesh( temp, shaderMaterial )
			trianglesplane.queryVertices = geometry.queryVertices	
			trianglesplane.attributes = attributes
			View.trianglesplane = trianglesplane		
			View.addGeometry View.trianglesplane
