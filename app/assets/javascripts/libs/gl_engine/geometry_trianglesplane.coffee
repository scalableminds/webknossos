class Trianglesplane extends Geometry
	constructor: (vertexShader, fragmentShader) ->
		super(vertexShader, fragmentShader)
		@vertexIndex = 
			EBO : null
			length : null	

		@interpolationFront = 
			VBO : null
			length : null	

		@interpolationBack = 
			VBO : null
			length : null	

		@interpolationOffset = 
			VBO : null
			length : null							
		
		@type = "Trianglesplane"

	setVertexIndex : (data, len) -> 
		@vertexIndex.EBO = data
		@vertexIndex.length = len

	setInterpolationFront : (data, len) -> 
		@interpolationFront.VBO = data
		@interpolationFront.length = len
		
	setInterpolationBack : (data, len) -> 
		@interpolationBack.VBO = data
		@interpolationBack.length = len
		
	setInterpolationOffset : (data, len) -> 
		@interpolationOffset.VBO = data
		@interpolationOffset.length = len						

	setNormalVertices : (data, width) -> 
		@normalVertices = data
		@normalVerticesWidth = width

	setVertices : (data, len) -> 
		super data, len

	setColors : (data, len) ->
		super data, len

	setNormals : (data, len) ->
		super data, len

	getClassType : ->
		super
