### define ###

class Geometry
	constructor : (vertexShader, fragmentShader) ->
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

		@vertexShader = vertexShader
		@fragmentShader = fragmentShader
		@shaderProgram = null

		@type = "Geometry"
		@name = ""		

		@relativePosition = {
			x : 0,
			y : 0,
			z : 0 
		}		

		@scaleFactor = {
			x : 1,
			y : 1,
			z : 1 
		}		

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

	setName : (name) ->
		@name = name
 
	#returns the ClassName of an object
	getClassType : ->
		@type
