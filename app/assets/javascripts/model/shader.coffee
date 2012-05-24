### define
libs/request : request
###

# This loads and caches a pair (vertex and fragment) shaders

Shader =

  get : _.memoize (name) ->

    $.when(
      request(url : "/assets/shader/#{name}.vs"), 
      request(url : "/assets/shader/#{name}.fs")
    ).pipe (vertexShader, fragmentShader) -> { vertexShader, fragmentShader }
