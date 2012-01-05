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