class Mesh extends Geometry
	constructor: ->
		super()
		@vertexIndex = {
			EBO : null
			length : null	
		}

	setVertexIndex : (data) -> 
		@vertexIndex.EBO = data
		@vertexIndex.length = data.length
