class Pointcloud extends Geometry
	constructor: (fragmentShader, vertexShader) ->
		super(fragmentShader, vertexShader)
		@type = "Pointcloud"

	setVertices : (data, len) -> 
		super data, len

	setColors : (data, len) ->
		super data, len

	setNormals : (data, len) ->
		super data, len

	getClassType : ->
		super
