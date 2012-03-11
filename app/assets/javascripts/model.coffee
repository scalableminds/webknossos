# This is the model. It takes care of the data including the 
# communication with the server.

# All public operations are **asynchronous**. We return a promise
# which you can react on.
define [
		"model/binary"
		"model/shader"
		"model/route"
		"model/mesh"
		"model/trianglesplane"
	], (Binary, Shader, Route, Mesh, Trianglesplane) ->
  	Model = { Binary, Shader, Route, Mesh, Trianglesplane }

