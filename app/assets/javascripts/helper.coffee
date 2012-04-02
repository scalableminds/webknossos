define(
	[
		"view"
	]
	(View) ->

		Helper =

			# This is a simple Helper object. We felt like visualizing 
			# the Model's pre-loading algorithm in order to better debug it.
			# It does so by rendering the bucket position to three canvases: 
			# XY, XZ, YZ - planes

			enabled : false
			buckets : []

			XYcanvas : null
			XZcanvas : null
			YZcanvas : null

			CANVAS_WIDTH : 400
			BUCKET_WIDTH : 64

			# Let initialize this bad boy.
			# First attach the three axes to the DOM and 
			# draw the coordinate axes.
			# Lastly attach a callback to the "bucketloaded" event
			# and handle it.
			initialize : ->
				@XYcanvas = $("<canvas id=\"XYcanvas\" width=" + @CANVAS_WIDTH + " height="+ @CANVAS_WIDTH + "/>").appendTo("div#main")
				@XZcanvas = $("<canvas id=\"XZcanvas\" width=" + @CANVAS_WIDTH + " height="+ @CANVAS_WIDTH + " style=\"margin-left:1.0em;\" />").appendTo("div#main")
				@YZcanvas = $("<canvas id=\"YZcanvas\" width=" + @CANVAS_WIDTH + " height="+ @CANVAS_WIDTH + " style=\"margin-left:1.0em;\" />").appendTo("div#main")
				@XYcanvas = $(@XYcanvas)[0].getContext("2d")
				@XZcanvas = $(@XZcanvas)[0].getContext("2d")
				@YZcanvas = $(@YZcanvas)[0].getContext("2d")

				$(window).on "bucketloaded", (event, vertex) => @addCube vertex

			# This method adds a new bucket coordinate to the global list
			# and the clears all three canvases and repaints them.
			addCube : (position) ->
			
				@buckets.push position

				camLocation = View.getMatrix()

				xOffset = (camLocation[12] - @CANVAS_WIDTH / 2)
				yOffset = (camLocation[13] - @CANVAS_WIDTH / 2)
				zOffset = (camLocation[14] - @CANVAS_WIDTH / 2)

				@XYcanvas.clearRect(0, 0, @CANVAS_WIDTH, @CANVAS_WIDTH)
				@XZcanvas.clearRect(0, 0, @CANVAS_WIDTH, @CANVAS_WIDTH)
				@YZcanvas.clearRect(0, 0, @CANVAS_WIDTH, @CANVAS_WIDTH)

				@drawAxes()

				for bucket in @buckets
					x = bucket[0] - xOffset 
					y = bucket[1] - yOffset
					z = bucket[2] - zOffset

					@XYcanvas.fillRect(x, y, 10, 10)
					@XZcanvas.fillRect(x, z, 10, 10)
					@YZcanvas.fillRect(z, y, 10, 10)

			# This method allows you to toggle the Helper on or off.
			toogleHelper : ->
				enabled != enabled
				if enabled
					@initialize
				else
					@removeCanvas

			# Paint coordinate axes on each canvas and label them.
			drawAxes : ->
				@XYcanvas.fillRect(0, 0, 1, @CANVAS_WIDTH)
				@XYcanvas.fillText("Y", 0, @CANVAS_WIDTH)
				@XYcanvas.fillRect(0, 0, @CANVAS_WIDTH, 1 )
				@XYcanvas.fillText("X", @CANVAS_WIDTH - 10, 10)				

				@XZcanvas.fillRect(0, 0, 1, @CANVAS_WIDTH)
				@XZcanvas.fillText("Z", 0, @CANVAS_WIDTH)
				@XZcanvas.fillRect(0, 0, @CANVAS_WIDTH, 1 )
				@XZcanvas.fillText("X", @CANVAS_WIDTH - 10, 10)	

				@YZcanvas.fillRect(0, 0, 1, @CANVAS_WIDTH)
				@YZcanvas.fillText("Y", 0, @CANVAS_WIDTH)
				@YZcanvas.fillRect(0, 0, @CANVAS_WIDTH, 1 )
				@YZcanvas.fillText("Z", @CANVAS_WIDTH - 10, 10)		

			# We have to detach the canvases from the DOM once
			# the Helper has been deactivated.
			removeCanvas : ->
				$("#XYcanvas").detach()
				$("#XZcanvas").detach()
				$("#YZcanvas").detach()

)
