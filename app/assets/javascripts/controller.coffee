class _Controller
	
	loadPointcloud : ->
		View.setCamera([800,200,200])
		GeometryFactory.loadPointcloud([800,200,200], [0,1,0],"default")

	demo : ->
		@loadPointcloud()		

  # mouse events
  
  # keyboard events

Controller = new _Controller

start = ->
	Controller.demo()

