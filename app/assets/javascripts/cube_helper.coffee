define
[
	"geometry_factory",
	"view"
],
(GeometryFactory, View) ->

	Cuber =

		cubeCount : 0

		addCube : (position) ->
			GeometryFactory.createMesh("cube", "cube" + cubeCount).done (mesh) ->
							mesh.relativePosition.x = 200 + position[x]
							mesh.relativePosition.y = 200 + position[y]
							mesh.relativePosition.z = position[z]

							mesh.scaleFactor = {0.64, 0.64, 0.64}
							View.addGeometry mesh
			cubeCount++

		rotateCubes : ->
			#TODO

		Cuber