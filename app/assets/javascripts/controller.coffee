class _Controller
	
	#global variables for camera/plane 
	position = null
	direction = null

	initialize : () ->
		# initialize route tracking
		Model.Route.initialize((err, pos, dir) =>
			unless err
				position = pos
				direction = dir
				@loadPointcloud()
				View.startRendering()
		)

		#reload pointcloud every 20s
		setInterval("Controller.loadPointcloud()", 20000)


	#request GeometryFactroy to load a pointcloud from the model
	loadPointcloud : () ->
		View.setCamera(position)
		GeometryFactory.loadPointcloud position, direction,"pointcloud"

	# store new position and direction
	update : (pos, dir) ->
		position = pos
		direction = dir
		@notifyModel()

	# notify model of the postion changes for route tracking / pointcloud caching
	notifyModel : () ->
		Model.Route.put(position, (err) =>
			console.log err
		)


  # mouse events
  
  # keyboard events

Controller = new _Controller

start = ->
	Controller.initialize()

