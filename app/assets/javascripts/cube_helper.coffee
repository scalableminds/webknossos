define(
	[
		"geometry_factory",
		"view"
	]
	(GeometryFactory, View) ->

		CubeHelper =

			cubeCount : 0
			rootCube : null
			XYcanvas : null
			XZcanvas : null
			YZcanvas : null

			origin: [500, 500, 500]
			canvasSize : 400

			initialize : ->
				@XYcanvas = $("<canvas id=\"XYcanvas\" width=" + @canvasSize + " height="+ @canvasSize + "/>").appendTo("div#main")
				@XZcanvas = $("<canvas id=\"XZcanvas\" width=" + @canvasSize + " height="+ @canvasSize + " style=\"margin-left:1.0em;\" />").appendTo("div#main")
				@YZcanvas = $("<canvas id=\"YZcanvas\" width=" + @canvasSize + " height="+ @canvasSize + " style=\"margin-left:1.0em;\" />").appendTo("div#main")
				@XYcanvas = $(@XYcanvas)[0].getContext("2d")
				@XZcanvas = $(@XZcanvas)[0].getContext("2d")
				@YZcanvas = $(@YZcanvas)[0].getContext("2d")

				#axes
				@XYcanvas.fillRect(0, 0, 1, @canvasSize)
				@XYcanvas.fillText("Y", 0, @canvasSize)
				@XYcanvas.fillRect(0, 0, @canvasSize, 1 )
				@XYcanvas.fillText("X", @canvasSize - 10, 10)				

				@XZcanvas.fillRect(0, 0, 1, @canvasSize)
				@XZcanvas.fillText("Z", 0, @canvasSize)
				@XZcanvas.fillRect(0, 0, @canvasSize, 1 )
				@XZcanvas.fillText("X", @canvasSize - 10, 10)	

				@YZcanvas.fillRect(0, 0, 1, @canvasSize)
				@YZcanvas.fillText("Y", 0, @canvasSize)
				@YZcanvas.fillRect(0, 0, @canvasSize, 1 )
				@YZcanvas.fillText("Z", @canvasSize - 10, 10)

				$(window).on "bucketloaded", (event, vertex) => @addCube vertex

			addCube : (position) ->
			
				x = position[0] - @origin[0]
				y = position[1] - @origin[1]
				z = position[2] - @origin[2]

				console.log x, y, z

				@XYcanvas.fillRect(x, y, 10, 10)
				@XZcanvas.fillRect(x, z, 10, 10)
				@YZcanvas.fillRect(z, y, 10, 10)

				# GeometryFactory.createMesh("cube", "mesh", "cubes").done (mesh) =>
				
				# 	mesh.relativePosition.x = position[0] + 50
				# 	mesh.relativePosition.y = position[1] + 50
				# 	mesh.relativePosition.z = position[2] 

				# 	if @rootCube?
				# 		@rootCube.addChild mesh
				# 	else
				# 		@rootCube = mesh
				# 		View.addGeometry @rootCube

				@cubeCount++

)
