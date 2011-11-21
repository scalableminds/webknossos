class Geometry
        constructor : ->

		@verticies = {
			VBO : null
			length : null
			}
	
		@colors = {
			VBO : null
			length : null
			hasColors : null	
			}

		@normals = {
			VBO : null
			length : null	
			hasNormals : null	
			}

	setVerticies : (data) -> 
		@verticies.VBO = data
		@verticies.length = data.length

	setColors : (data) -> 
		@colors.VBO = data
		@colors.length = data.length	
		@hasColors = true

	setNormals : (data) -> 
		@normals.VBO = data
		@normals.length = data.length	
		@hasNormals = true

	
