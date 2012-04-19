### define
"libs/gl_engine/geometry" : Geometry
###

class Trianglesplane extends Geometry
	constructor: (vertexShader, fragmentShader) ->
		super(vertexShader, fragmentShader)
		@vertexIndex = 
			EBO : null
			length : null	

		@interpolationBuffer0 = 
			VBO : null
			length : null	

		@interpolationBuffer1 = 
			VBO : null
			length : null	

		@interpolationBufferDelta = 
			VBO : null
			length : null				

		#plain plane
		@normalVertices = null

		#curved plane
		@queryVertices = null
		
		@type = "Trianglesplane"

	setVertexIndex : (data, len) -> 
		@vertexIndex.EBO = data
		@vertexIndex.length = len

	setInterpolationBuffer0 : (data, len) -> 
		@interpolationBuffer0.VBO = data
		@interpolationBuffer0length = len
		
	setInterpolationBuffer1 : (data, len) -> 
		@interpolationBuffer1.VBO = data
		@interpolationBuffer1.length = len
		
	setInterpolationBufferDelta : (data, len) -> 
		@interpolationBufferDelta.VBO = data
		@interpolationBufferDelta.length = len						

	setNormalVertices : (data) -> 
		@normalVertices = data

	setQueryVertices : (data) -> 
		@queryVertices = data	

	setVertices : (data, len) -> 
		super data, len

	setColors : (data, len) ->
		super data, len

	setNormals : (data, len) ->
		super data, len

	getClassType : ->
		super
