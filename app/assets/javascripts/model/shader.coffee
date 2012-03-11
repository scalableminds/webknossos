# This loads and caches a pair (vertex and fragment) shaders
define ["libs/request"], (request) ->
	Shader =

		get : _.memoize (name) ->

			$.when(
				request(url : "/assets/shader/#{name}.vs"), 
				request(url : "/assets/shader/#{name}.fs")
			).pipe (vertexShader, fragmentShader) -> { vertexShader, fragmentShader }

	Shader