# Applies a transformation matrix on an array of points.
M4x4.transformPointsAffine = (m, points, r = new MJS_FLOAT_ARRAY_TYPE(points.length)) ->

  for i in [0...points.length] by 3
    v0 = points[i]
    v1 = points[i + 1]
    v2 = points[i + 2]
    
    r[i]     = m[0] * v0 + m[4] * v1 + m[8] * v2 + m[12]
    r[i + 1] = m[1] * v0 + m[5] * v1 + m[9] * v2 + m[13]
    r[i + 2] = m[2] * v0 + m[6] * v1 + m[10] * v2 + m[14]

  r

# Applies a transformation matrix on an array of points.
M4x4.transformPointsAffineWithTranslation = (m, translationVector, points, r = new MJS_FLOAT_ARRAY_TYPE(points.length)) ->

  [tx, ty, tz] = translationVector

  for i in [0...points.length] by 3
    v0 = points[i]
    v1 = points[i + 1]
    v2 = points[i + 2]
    
    r[i]     = m[0] * v0 + m[4] * v1 + m[8] * v2 + m[12] + tx
    r[i + 1] = m[1] * v0 + m[5] * v1 + m[9] * v2 + m[13] + ty
    r[i + 2] = m[2] * v0 + m[6] * v1 + m[10] * v2 + m[14] + tz

  r

M4x4.makeRotate2 = (direction, r = new MJS_FLOAT_ARRAY_TYPE(16)) ->

  # orthogonal vector to (0,1,0) and rotation vector
  axis = V3.normalize([direction[2], 0, -direction[0]])

  # dot product of (0,1,0) and rotation
  dotProd = direction[1]
  
  # transformation of dot product for cosA
  cosA = dotProd / V3.length(direction)
  sinA = Math.sqrt(1 - cosA * cosA)

  [axis_x, axix_y, axis_z] = axis
  
  # calculate rotation matrix
  r[0]  = axis_x * axis_x * (1 - cosA) + cosA 
  r[1]  = axis_z * sinA
  r[2]  = axis_x * axis_z * (1 - cosA)
  r[3]  = 0
  r[4]  = -axis_z * sinA
  r[5]  = cosA
  r[6]  = axis_x * sinA
  r[7]  = 0
  r[8]  = axis_x * axis_z * (1 - cosA)
  r[9]  = -axis_x * sinA
  r[10] = axis_z * axis_z * (1 - cosA) + cosA
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
    
    mat = M4x4.makeRotate2(directionVector)
    
    M4x4.transformPointsAffineWithTranslation(mat, translationVector, vertices, output)

M4x4.inverse = (mat) ->
  # cache matrix values
  a00 = mat[0]
  a01 = mat[1]
  a02 = mat[2]
  a03 = mat[3]
  a10 = mat[4]
  a11 = mat[5]
  a12 = mat[6]
  a13 = mat[7]
  a20 = mat[8]
  a21 = mat[9]
  a22 = mat[10]
  a23 = mat[11]
  a30 = mat[12]
  a31 = mat[13]
  a32 = mat[14]
  a33 = mat[15]
  b00 = a00 * a11 - a01 * a10
  b01 = a00 * a12 - a02 * a10
  b02 = a00 * a13 - a03 * a10
  b03 = a01 * a12 - a02 * a11
  b04 = a01 * a13 - a03 * a11
  b05 = a02 * a13 - a03 * a12
  b06 = a20 * a31 - a21 * a30
  b07 = a20 * a32 - a22 * a30
  b08 = a20 * a33 - a23 * a30
  b09 = a21 * a32 - a22 * a31
  b10 = a21 * a33 - a23 * a31
  b11 = a22 * a33 - a23 * a32

  # calculate determinant
  invDet = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06)

  dest = []
  dest[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet
  dest[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * invDet
  dest[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet
  dest[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * invDet
  dest[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * invDet
  dest[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet
  dest[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * invDet
  dest[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet
  dest[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet
  dest[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * invDet
  dest[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet
  dest[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * invDet
  dest[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * invDet
  dest[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet
  dest[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * invDet
  dest[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet

  return dest

# `_.throttle2` makes a function only be executed once in a given
# time span -- no matter how often you it. We don't recomment to use 
# any input parameters, because you cannot know which are used and 
# which are dropped. In contrast to `_.throttle`, the function
# at the beginning of the time span.
_.throttle2 = (func, wait, resume = true) ->
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
      more = resume and true

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


_.mutex = (func, timeout = 20000) ->

  busy = false
  i = 0

  (args...) ->
    unless busy
      
      i++
      current = i
      busy = true

      done = ->
        busy = false if i == current
      
      func.apply(this, args.concat(done))

      setTimeout(done, timeout)
