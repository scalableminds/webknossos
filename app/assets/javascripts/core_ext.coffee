M4x4.transformPointsAffine = (m, points, r) ->
  # MathUtils_assert(m.length === 16, "m.length === 16");
  # MathUtils_assert(v.length === 3, "v.length === 3");
  # MathUtils_assert(r === undefined || r.length === 3, "r === undefined || r.length === 3");
  
  r = new MJS_FLOAT_ARRAY_TYPE(points.length) unless r?

  for i in [0...points.length] by 3
    v0 = points[i]
    v1 = points[i + 1]
    v2 = points[i + 2]
    
    r[i]     = m[0] * v0 + m[4] * v1 + m[8] * v2 + m[12]
    r[i + 1] = m[1] * v0 + m[5] * v1 + m[9] * v2 + m[13]
    r[i + 2] = m[2] * v0 + m[6] * v1 + m[10] * v2 + m[14]

  r

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



Interpolation =
  linear : (p0, p1, d) ->
    if p0 == -1 or p1 == -1
      0
    else
      p0 * (1 - d) + p1 * d
  
  bilinear : (p00, p01, p10, p11, d0, d1) ->
    if p00 == -1 or p01 == -1 or p10 == -1 or p11 == -1
      0
    else
      p00 * (1 - d0) * (1 - d1) + 
      p01 * d0 * (1 - d1) + 
      p10 * (1 - d0) * d1 + 
      p11 * d0 * d1
    
  trilinear : (p000, p001, p010, p011, p100, p101, p110, p111, d0, d1, d2) ->
    if p000 == -1 or p001 == -1 or p010 == -1 or p011 == -1 or p100 == -1 or p101 == -1 or p110 == -1 or p111 == -1
      0
    else
      p000 * (1 - d0) * (1 - d1) * (1 - d2) +
      p001 * d0 * (1 - d1) * (1 - d2) + 
      p010 * (1 - d0) * d1 * (1 - d2) + 
      p011 * (1 - d0) * (1 - d1) * d2 +
      p100 * d0 * (1 - d1) * d2 + 
      p101 * (1 - d0) * d1 * d2 + 
      p110 * d0 * d1 * (1 - d2) + 
      p111 * d0 * d1 * d2

interpolate = (x, x0, x1, xd, y, y0, y1, yd, z, z0, z1, zd, get)->
  if xd == 0
    if yd == 0
      if zd == 0
        get(x, y, z)
      else
        #linear z
        Interpolation.linear(get(x, y, z0), get(x, y, z1), zd)
    else
      if zd == 0
        #linear y
        Interpolation.linear(get(x, y0, z), get(x, y1, z), yd)
      else
        #bilinear y,z
        Interpolation.bilinear(
          get(x, y0, z0), 
          get(x, y1, z0), 
          get(x, y0, z1), 
          get(x, y1, z1), 
          yd, zd)
  else
    if yd == 0
      if zd == 0
        #linear x
        Interpolation.linear(get(x0, y, z), get(x1, y, z), xd)
      else
        #bilinear x,z
        Interpolation.bilinear(
          get(x0, y, z0), 
          get(x1, y, z0), 
          get(x0, y, z1), 
          get(x1, y, z1), 
          xd, zd)
    else
      if zd == 0
        #bilinear x,y
        Interpolation.bilinear(
          get(x0, y0, z), 
          get(x1, y0, z), 
          get(x0, y1, z), 
          get(x1, y1, z), 
          xd, yd)
      else
        #trilinear x,y,z
        Interpolation.trilinear(
          get(x0, y0, z0),
          get(x1, y0, z0),
          get(x0, y1, z0),
          get(x1, y1, z0),
          get(x0, y0, z1),
          get(x1, y0, z1),
          get(x0, y1, z1),
          get(x1, y1, z1),
          xd, yd, zd
        )