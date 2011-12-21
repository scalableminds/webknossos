class _Controller
	
	loadPointcloud : ->
		GeometryFactory.requestPointcloud([0,0,0], [0,1,0])

	demo : ->
		@loadPointcloud()		

  # mouse events
  
  # keyboard events

Controller = new _Controller

start = ->
	Controller.demo()

