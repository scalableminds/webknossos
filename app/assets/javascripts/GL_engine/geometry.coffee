class Geometry
	constructor : (fragmentShader, vertexShader) ->
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
		@fragmentShader = fragmentShader
		@vertexShader = vertexShader

		@type = "Geometry"				

	setVertices : (data, len) -> 
		@vertices.VBO = data
		@vertices.length = len

	setColors : (data, len) -> 
		@colors.VBO = data
		@colors.length = len
		@hasColors = true

	setNormals : (data, len) -> 
		@normals.VBO = data
		@normals.length = len	
		@hasNormals = true

	#returns the ClassName of an object
	getClassType : ->
		@type
	
