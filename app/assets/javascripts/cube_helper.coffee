define(
	[
		"geometry_factory",
		"view"
	]
	(GeometryFactory, View) ->

		CubeHelper =

			cubeCount : 0
			cubes : []

			initialize : ->
				$(window).on "bucketloaded", (event, vertex) => @addCube vertex

			addCube : (position) ->

				GeometryFactory.createMesh("cube", "mesh", "cubes").done (mesh) =>
				
					mesh.relativePosition.x = position[0]
					mesh.relativePosition.y = position[1]
					mesh.relativePosition.z = position[2]
					@cubes.push mesh
					View.addGeometry @cubes
					@cubeCount++

)
