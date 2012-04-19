### define 
"libs/gl_engine/geometry" : Geometry
###

class Mesh extends Geometry
	constructor: (vertexShader, fragmentShader) ->
		super(vertexShader, fragmentShader)
		@vertexIndex = 
			EBO : null
			length : null	
		
		@type = "Mesh"
		@children = []

	addChild : (mesh) ->
		@children.push mesh

	removeChild : (mesh) ->
		@children = _.without @children, mesh

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