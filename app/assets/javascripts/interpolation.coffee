# This provides interpolation mechanics. It's a lot of code. But it
# should run fast.
Interpolation =
  linear : (p0, p1, d) ->
    if p0 == 0 or p1 == 0
      0
    else
      p0 * (1 - d) + p1 * d
  
  bilinear : (p00, p10, p01, p11, d0, d1) ->
    if p00 == 0 or p10 == 0 or p01 == 0 or p11 == 0
      0
    else
      p00 * (1 - d0) * (1 - d1) + 
      p10 * d0 * (1 - d1) + 
      p01 * (1 - d0) * d1 + 
      p11 * d0 * d1
    
  trilinear : (p000, p100, p010, p110, p001, p101, p011, p111, d0, d1, d2) ->
    if p000 == 0 or p100 == 0 or p010 == 0 or p110 == 0 or p001 == 0 or p101 == 0 or p011 == 0 or p111 == 0
      0
    else
      p000 * (1 - d0) * (1 - d1) * (1 - d2) +
      p100 * d0 * (1 - d1) * (1 - d2) + 
      p010 * (1 - d0) * d1 * (1 - d2) + 
      p110 * d0 * d1 * (1 - d2) +
      p001 * (1 - d0) * (1 - d1) * d2 + 
      p101 * d0 * (1 - d1) * d2 + 
      p011 * (1 - d0) * d1 * d2 + 
      p111 * d0 * d1 * d2

# Use this function to have your point interpolated. We'll figure
# out whether linear, bilinear or trilinear interpolation is best.
# But, you need to give us the `get` callback so we can find points
# in your data structure. Keep in mind that the `get` function
# probably loses its scope (hint: use `_.bind`)
interpolate = (x, y, z, get)->
  
  # Bitwise operations are faster than javascript's native rounding functions.
  x0 = x >> 0; x1 = x0 + 1; xd = x - x0     
  y0 = y >> 0; y1 = y0 + 1; yd = y - y0
  z0 = z >> 0; z1 = z0 + 1; zd = z - z0

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