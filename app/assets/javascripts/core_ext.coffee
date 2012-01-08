# Applies a transformation matrix on an array of points.
M4x4.transformPointsAffine = (m, points, r) ->
  
  r = new MJS_FLOAT_ARRAY_TYPE(points.length) unless r?

  for i in [0...points.length] by 3
    v0 = points[i]
    v1 = points[i + 1]
    v2 = points[i + 2]
    
    r[i]     = m[0] * v0 + m[4] * v1 + m[8] * v2 + m[12]
    r[i + 1] = m[1] * v0 + m[5] * v1 + m[9] * v2 + m[13]
    r[i + 2] = m[2] * v0 + m[6] * v1 + m[10] * v2 + m[14]

  r

# Moves an array of vertices. It also supports rotation, just provide
# a vector representing the direction you're looking. The vertices
# are considered to be at position `[0,0,0]` with the direction `[0,1,0]`.
M4x4.moveVertices = (vertices, translationVector, directionVector) ->

  output = new Float32Array(vertices.length)
  directionVector = V3.normalize(directionVector)

  # `[0,1,0]` is the axis of the template, so there is no need for rotating
  # We can do translation on our own, because it's not too complex..and 
  # probably faster.
  if directionVector[0] == 0 and directionVector[1] == 1 and directionVector[2] == 0

    [px, py, pz] = translationVector
    
    for i in [0...template.length] by 3
      output[i]     = px + template[i]
      output[i + 1] = py + template[i + 1]
      output[i + 2] = pz + template[i + 2]
    output
  
  else
    
    mat = M4x4.makeRotate V3.angle([0,1,0], directionVector), [directionVector[2], 0, -directionVector[0]]
    mat = M4x4.translateSelf translationVector, mat
  
    M4x4.transformPointsAffine(mat, vertices, output)

# `_.throttle2` makes a function only be executed once in a given
# time span -- no matter how often you it. The function cannot have 
# any input parameters. In contrast to `_.throttle`, the function
# at the beginning of the time span.
_.throttle2 = (func, wait) ->
  timeout = more = false

  ->
    context = @
    args = arguments
    if timeout == false
      _.defer -> func.apply(context, arguments)
      timeout = setTimeout (
        -> 
          timeout = false
          func.apply(context, arguments) if more
          more = false
        ), wait
    else
      more = true

# `_.once2` makes sure a function is executed only once. It works only
# with asynchronous functions. The function cannot have any input 
# parameters. If one pass of the function failes, it can be executed 
# again.
_.once2 = (func) ->
  initialized = false
  watingCallbacks = null

  done = (err) ->
    callbacks = watingCallbacks
    watingCallbacks = null

    callback = (args...) ->
      cb(args...) for cb in callbacks
      return

    if err
      callback err
      return
    else
      initialized = true
      return callback
  
  (callback) ->
    context = @

    unless initialized
      if watingCallbacks?
        watingCallbacks.push callback
      else
        watingCallbacks = [callback]
        func.apply(context, [done])
    else
      callback null

