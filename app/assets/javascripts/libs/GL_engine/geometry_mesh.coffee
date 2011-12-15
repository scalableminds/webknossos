class Mesh extends Geometry
	constructor: ->
		super()
		@vertexIndex = 
			EBO : null
			length : null	
		
		@type = "Mesh"

	setVertexIndex : (data) -> 
		@vertexIndex.EBO = data
		@vertexIndex.length = data.length
