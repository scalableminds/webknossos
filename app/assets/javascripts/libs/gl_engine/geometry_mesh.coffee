class Mesh extends Geometry
	constructor: (fragmentShader, vertexShader) ->
		super(fragmentShader, vertexShader)
		@vertexIndex = 
			EBO : null
			length : null	
		
		@type = "Mesh"

	setVertexIndex : (data, len) -> 
		@vertexIndex.EBO = data
		@vertexIndex.length = len

	setVertices : (data, len) -> 
		super data, len

	setColors : (data, len) ->
		super data, len

	setNormals : (data, len) ->
		super data, len

	getClassType : ->
		super
