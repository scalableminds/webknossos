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

M4x4.makeRotate2 = (axis, r) ->

  r = new MJS_FLOAT_ARRAY_TYPE(16) unless r?

  # orthogonal vector to (0,1,0) and rotation vector
  ortho = V3.normalize([axis[2], 0, -axis[0]])

  # dot product of (0,1,0) and rotation
  dotProd = axis[1]
  
  # transformation of dot product for cosA
  cosA = dotProd / V3.length(axis)
  sinA = Math.sqrt(1 - cosA * cosA)
  
  # calculate rotation matrix
  r[0] = cosA + ortho[0] * ortho[0] * (1 - cosA)
  r[1] = -ortho[2] * sinA
  r[2] = ortho[0] * ortho[2] * (1 - cosA)
  r[3] = 0
  r[4] = ortho[2] * sinA
  r[5] = cosA
  r[6] = -ortho[0] * sinA
  r[7] = 0
  r[8] = ortho[0] * ortho[2] * (1 - cosA)
  r[9] = ortho[0] * sinA
  r[10] = cosA + ortho[2] * ortho[2] * (1 - cosA)
  r[11] = 0
  r[12] = 0
  r[13] = 0
  r[14] = 0
  r[15] = 0
  
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
    
    for i in [0...vertices.length] by 3
      output[i]     = px + vertices[i]
      output[i + 1] = py + vertices[i + 1]
      output[i + 2] = pz + vertices[i + 2]
    output
  
  else
    
    mat = M4x4.makeRotate2 directionVector
    mat = M4x4.translateSelf translationVector, mat
  
    M4x4.transformPointsAffine(mat, vertices, output)

# `_.throttle2` makes a function only be executed once in a given
# time span -- no matter how often you it. We don't recomment to use 
# any input parameters. In contrast to `_.throttle`, the function
# at the beginning of the time span.
_.throttle2 = (func, wait) ->
  timeout = more = false

  ->
    context = @
    args = arguments
    if timeout == false
      _.defer -> func.apply(context, args)
      timeout = setTimeout (
        -> 
          timeout = false
          func.apply(context, args) if more
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


_.mutex = (func, timeout = 60000) ->

  busy = false

  done = ->
    busy = false

  (args...) ->
    unless busy
      
      busy = true
      
      func.apply(this, args.concat(done))

      setTimeout(done, timeout)

