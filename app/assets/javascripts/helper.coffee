### define
view : View
###

Helper =

	# This is a simple Helper object. We felt like visualizing 
	# the Model's pre-fetching algorithm in order to better debug it.
	# It does so by rendering the bucket position to three canvases: 
	# XY, XZ, YZ - planes
	# However, we only render those buckets that are currently
	# intersecting the view-plane ("the camera's field of view").

	enabled : false
	buckets : []

	XYcanvas : null
	XZcanvas : null
	YZcanvas : null

	CANVAS_WIDTH : 400
	BUCKET_WIDTH : 64
	PIXEL_SIZE : 40
	EPSILON : 1e-10

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

		@drawAxes()

		$(window).on "bucketloaded", (event, vertex) => @addCube vertex
		$("html, body").animate({scrollTop: @CANVAS_WIDTH}, 800);

	# This method adds a new bucket coordinate to the global list.
	# For each bucket we check wether it intersects the view-plane by
	# calculating the distance of each of the 8 bucket corners to the plane.
	# If it intersects we go one to render it on the canvas.
	addCube : (position) ->
	
		@buckets.push position
		intersectingBuckets = []
		
		camLocation = View.getMatrix()
		positionVertex = new Float32Array(3)
		positionVertex[0] = camLocation[12]
		positionVertex[1] = camLocation[13]
		positionVertex[2] = camLocation[14]
		
		planeNormal = new Float32Array(3)
		planeNormal[2] = 1
		M4x4.transformLineAffine(camLocation, planeNormal, planeNormal)

		planeDistance = V3.dot(positionVertex, planeNormal)

		for bucket in @buckets

			# determine whether a bucket is intersecting the plane
			# i.e. the bucket has corners on both side of the plane
			# implementation very similar to Model.ping
			frontCorners = 0
			backCorners  = 0
			corner = new Float32Array(3)

			for cornerX in [0, 63]
				for cornerY in [0, 63]
					for cornerZ in [0, 63]

						corner[0] = bucket[0] + cornerX
						corner[1] = bucket[1] + cornerY
						corner[2] = bucket[2] + cornerZ

						cornerSide = planeDistance - V3.dot(planeNormal, corner)

						if cornerSide < -@EPSILON
							backCorners++ 
						else if cornerSide > @EPSILON
							frontCorners++

			if frontCorners
				if backCorners	
					intersectingBuckets.push bucket

		@drawBuckets(intersectingBuckets)


	# Clear and re-paint the canvases with buckets
	# that intersect the plane.
	drawBuckets : (buckets) ->
		#import to local scope
		margin = 0.7
		text_size = @PIXEL_SIZE / 3
		pixel_size = @PIXEL_SIZE
		canvas_width = @CANVAS_WIDTH
		XYcanvas = @XYcanvas
		XZcanvas = @XZcanvas
		YZcanvas = @YZcanvas


		camLocation = View.getMatrix()
		# make sure all buckets are drawn around the center
		# of the canvas
		xOffset = (camLocation[12] - canvas_width / 2)
		yOffset = (camLocation[13] - canvas_width / 2)
		zOffset = (camLocation[14] - canvas_width / 2)

		# clear screen
		XYcanvas.clearRect(0, 0, canvas_width, canvas_width)
		XZcanvas.clearRect(0, 0, canvas_width, canvas_width)
		YZcanvas.clearRect(0, 0, canvas_width, canvas_width)

		factor = (pixel_size / @BUCKET_WIDTH ) + margin
		for bucket, i in buckets
			x = ( bucket[0] - xOffset ) * factor
			y = ( bucket[1] - yOffset ) * factor
			z = ( bucket[2] - zOffset ) * factor

			# bucket
			XYcanvas.fillStyle = "black"
			XYcanvas.fill()
			XZcanvas.fillStyle = "black"
			XZcanvas.fill()
			YZcanvas.fillStyle = "black"
			YZcanvas.fill()

			XYcanvas.fillRect(x, y, pixel_size, pixel_size)
			XZcanvas.fillRect(x, z, pixel_size, pixel_size)
			YZcanvas.fillRect(z, y, pixel_size, pixel_size)

			# text
			XYcanvas.fillStyle = "red"
			XYcanvas.fill()
			XZcanvas.fillStyle = "red"
			XZcanvas.fill()
			YZcanvas.fillStyle = "red"
			YZcanvas.fill()

			XYcanvas.fillText(i, x + text_size, y + text_size)
			XZcanvas.fillText(i, x + text_size, z + text_size)
			YZcanvas.fillText(i, z + text_size, y + text_size)

		@drawAxes(xOffset, yOffset, zOffset)

	# This method allows you to toggle the Helper on or off.
	toggle : ->
		@enabled = !@enabled
		if @enabled
			@initialize()
		else
			@removeCanvas()


	# Paint coordinate axes on each canvas and label them.
	# grün = x
	# blau = y
	# rot = z

	drawAxes : (xOffset, yOffset, zOffset)->
		#import to local scope
		canvas_width = @CANVAS_WIDTH
		XYcanvas = @XYcanvas
		XZcanvas = @XZcanvas
		YZcanvas = @YZcanvas

		xOffset = xOffset / 2
		yOffset = yOffset / 2
		zOffset = zOffset / 2

		XYcanvas.fillStyle = "blue"
		XYcanvas.fillRect(0, 0, 1, canvas_width)
		XYcanvas.fillText("Y", 0, canvas_width)
		XYcanvas.fillStyle = "green"
		XYcanvas.fillRect(0, 0, canvas_width, 1 )
		XYcanvas.fillText("X", canvas_width - 10, 10)		
		#crosshair
		XYcanvas.fillRect(xOffset, yOffset, 5, 5)

		XZcanvas.fillStyle = "red"
		XZcanvas.fillRect(0, 0, 1, canvas_width)
		XZcanvas.fillText("Z", 0, canvas_width)
		XZcanvas.fillStyle = "green"
		XZcanvas.fillRect(0, 0, canvas_width, 1 )
		XZcanvas.fillText("X", canvas_width - 10, 10)	
		#crosshair
		XZcanvas.fillRect(xOffset, zOffset, 5, 5)

		YZcanvas.fillStyle = "blue"
		YZcanvas.fillRect(0, 0, 1, canvas_width)
		YZcanvas.fillText("Y", 0, canvas_width)
		YZcanvas.fillStyle = "red"
		YZcanvas.fillRect(0, 0, canvas_width, 1 )
		YZcanvas.fillText("Z", canvas_width - 10, 10)
		#crosshair
		YZcanvas.fillRect(zOffset, yOffset, 5, 5)		

	# We have to detach the canvases from the DOM once
	# the Helper has been deactivated.
	removeCanvas : ->
		$("#XYcanvas").detach()
		$("#XZcanvas").detach()
		$("#YZcanvas").detach()
