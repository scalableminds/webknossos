class Geometry
	constructor : ->
		@vertices = 
			VBO : null
			length : null
				
		@colors = 
			VBO : null
			length : null
				
		@normals = 
			VBO : null
			length : null
	
		@hasNormals = false
		@hasColors = false
		@fragmentShader = null
		@vertexShader = null

		@type = "Geometry"				

	setVertices : (data) -> 
		@vertices.VBO = data
		@vertices.length = data.length

	setColors : (data) -> 
		@colors.VBO = data
		@colors.length = data.length	
		@hasColors = true

	setNormals : (data) -> 
		@normals.VBO = data
		@normals.length = data.length	
		@hasNormals = true

	#returns the ClassName of an object
	getClassType : ->
		@type
	
