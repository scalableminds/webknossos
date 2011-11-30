class Pointcloud extends Geometry
	constructor: ->
		super()
		@type = "Pointcloud"

	setVertices : (data, len) -> 
		super data, len

	setColors : (data, len) ->
		super data, len


