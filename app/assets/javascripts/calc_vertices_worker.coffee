# This is a worker for `Model.Binary`.
# It can do the calculation of vertices accompaning color data
# responded from the server on a `pull` request.
# First the worker loads a model of the response data represented
# as a convex polyhedron. Then for each invocation that model is
# transformed by a transformation matrix and rasterized, resulting
# the requested vertices.

# Loading script dependencies
importScripts(
	"libs/requirejs-1.0.7.js"
	"libs/underscore-1.2.0.min.js"
	"libs/mjs.js"
	"libs/deferreds.js"
)
require.config 
  baseUrl : "/assets/javascripts"
  locale  : "de-de"

require [
		"libs/request"
		"libs/polyhedron"
		"core_ext"
	], (request, Polyhedron) ->

		# Variables (global)
		polyhedronPrototype = null
		initializeDeferred  = null


		# This worker needs some initialization.
		# Specifically, it needs to load the polyhedron model of
		# the response data.
		initialize = ->
			
			unless initializeDeferred
				initializeDeferred = $.Deferred()
				
				initializeDeferred.fail ->
					initializeDeferred = null

				request(url : '/binary/polygons/cube')
					.done((data) ->
						
						polyhedronPrototype = Polyhedron.load(JSON.parse(data))
						initializeDeferred.resolve()

					).fail((err) -> initializeDeferred.reject(err))

			initializeDeferred.promise()


		self.onmessage = ( data : { workerHandle, matrix } ) ->
			
			initialize().done ->

				polyhedron = polyhedronPrototype.transform(matrix)

				vertices = polyhedron.rasterize()
				extent   = polyhedron.extent()
				
				postMessage { vertices, extent, workerHandle }