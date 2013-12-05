### define 
m4x4 : M4x4
###

# Constants
HEAP_SIZE = 1 << 25
HEAP = new ArrayBuffer(HEAP_SIZE)
Int32_MIN = -2147483648
Int32_MAX = 2147483647

# Macros
swapMacro = (a, b) ->
  __tmp = a
  a = b
  b = __tmp


crossMacro = (o0, o1, a0, a1, b0, b1) ->
  (a0 - o0) * (b1 - o1) - (a1 - o1) * (b0 - o0)


drawMacro = (x, y, z) ->

  __index_y = (z << shift_z) + (y << 1)

  buffer[__index_y]     = x if x < buffer[__index_y]
  buffer[__index_y + 1] = x if x > buffer[__index_y + 1]


# Returns the index of the next free bit.
# Example: 5 = 0000 0101 => 3
nextFreeBit = (x) ->
  n = 1
  if (x >> 16) == 0
    n = n + 16
    x <<= 16
  if (x >> 24) == 0
    n = n + 8
    x <<= 8
  if (x >> 28) == 0
    n = n + 4
    x <<= 4
  if (x >> 30) == 0
    n = n + 2
    x <<= 2
  32 - n - (x >> 31)


# Represents a convex polyhedron, which can be voxelized.
# Use it like this:
#     masterPolyhredon = new PolyhedronRasterizer.Master([...], [...])
#     polyhedron = masterPolyhedron.transformAffine(matrix)
#     output = polyhedron.collectPointsOnion(0, 0, 0)
#
# ##A word of caution:##
# The code is a bit verbose to keep it speedy. Also notice
# that using this class is nowhere near thread-safe. Each instance
# will use the same `HEAP`. Therefore two existing instances will
# definitely collide.
#
# ##How the algorithm works:##
# First, we use a buffer which holds all line segments orthogonal
# to the yz-plane belonging to the polyhedron, i.e. the smallest 
# and highest x-coordinate for all y- and z-coordinates currently 
# known.
# We start by drawing the edges of the polyhedron into the buffer.
# This results in having at least one point in each orthogonal plane.
# Knowing this, we slice polyhedron at each xy-plane (i.e. same 
# z-coordinate). We collect all points in this plane and run a convex
# hull algorithm over them, resulting in a convex polygon. We then draw
# edges of that polygon into our buffer. 
# Finally, we know all relevant line segments and can collect the points
# There are some algorithms available to determine the order of the 
# collected points.
#  
class PolyhedronRasterizer

  # Orientation of transformed polyhedron 1 if z orientation is positive else -1
  orientation : 1

  
  constructor : (@vertices, @indices) ->
    
    @calcExtent()
    { min_x, min_y, min_z, delta_z, delta_y, shift_z } = @

    @bufferLength = bufferLength = delta_z << shift_z
    @buffer = buffer = new Int32Array(HEAP, 0, bufferLength)

    # initialize buffer values
    for z in [0...delta_z] by 1
      index = z << shift_z
      for index_y in [0...delta_y] by 1
        buffer[index++] = Int32_MAX
        buffer[index++] = Int32_MIN

    # translate to 0 based coordinate system
    i = vertices.length
    while i
      vertices[--i] -= min_z
      vertices[--i] -= min_y
      vertices[--i] -= min_x

    # create convex hull buffers
    @pointsBuffer = new Int32Array(delta_y << 2)

    # draw edges of the polyhedron into the buffer
    @drawEdges()
    # fill each xy-plane with points
    @drawPolygons()


  calcExtent : ->
    
    min_x = min_y = min_z = Int32_MAX
    max_x = max_y = max_z = Int32_MIN

    vertices = @vertices

    i = 0
    while i < vertices.length
      x = vertices[i++]
      y = vertices[i++]
      z = vertices[i++]

      min_x = x if x < min_x 
      min_y = y if y < min_y 
      min_z = z if z < min_z 
      max_x = x if x > max_x 
      max_y = y if y > max_y 
      max_z = z if z > max_z 

    @min_x = min_x
    @min_y = min_y
    @min_z = min_z
    @max_x = max_x
    @max_y = max_y
    @max_z = max_z
    @delta_x = max_x - min_x + 1
    @delta_y = max_y - min_y + 1
    @delta_z = max_z - min_z + 1
    @shift_z = nextFreeBit((@delta_y << 1) - 1)

    return


  #transformAffine : (matrix) ->
  #  
  #  { min_x, min_y, min_z, vertices } = @
  #
  #  vertices1 = new Int32Array(vertices.length)
  #  i = vertices.length
  #  while i
  #    vertices1[--i] = vertices[i] + min_z
  #    vertices1[--i] = vertices[i] + min_y
  #    vertices1[--i] = vertices[i] + min_x
  #
  #  new PolyhedronRasterizer(
  #    M4x4.transformPointsAffine(matrix, vertices1, vertices1), 
  #    @indices
  #  )


  draw : (x, y, z) ->
    
    { buffer, shift_z } = @
    drawMacro(x, y, z)

    return

  drawEdges : ->
    # Draws the edges into the buffer.

    { indices, vertices } = @

    # rasterize edges with 3d bresenham
    i = indices.length
    while i
      
      i0 = indices[--i]
      i1 = indices[--i]

      @drawLine3d(
        vertices[i0++], 
        vertices[i0++], 
        vertices[i0],
        vertices[i1++], 
        vertices[i1++], 
        vertices[i1]
      )

    return


  drawLine3d : (x, y, z, x1, y1, z1) ->
    # Source: https://sites.google.com/site/proyectosroboticos/bresenham-3d
    
    { shift_z, buffer } = @
    
    x_inc = if (dx = x1 - x) < 0 then -1 else 1
    y_inc = if (dy = y1 - y) < 0 then -1 else 1
    z_inc = if (dz = z1 - z) < 0 then -1 else 1
    
    drawMacro(x, y, z)
    
    dx = if dx < 0 then -dx else dx
    dy = if dy < 0 then -dy else dy
    dz = if dz < 0 then -dz else dz
     
    dx2 = dx << 1
    dy2 = dy << 1
    dz2 = dz << 1
    

    if dx >= dy and dx >= dz

      d = dx
      mode = 0

    else if dy >= dz

      swapMacro(y, x)
      swapMacro(y_inc, x_inc)
      swapMacro(dy2, dx2)
      d = dy
      mode = 1

    else 
      swapMacro(z, x)
      swapMacro(z_inc, x_inc)
      swapMacro(dz2, dx2)
      d = dz
      mode = 2

    err_1 = dy2 - d
    err_2 = dz2 - d
      
    for i in [0...d] by 1

      if err_1 > 0
        y += y_inc
        err_1 -= dx2
      if err_2 > 0
        z += z_inc
        err_2 -= dx2
     
      err_1 += dy2
      err_2 += dz2
      x     += x_inc
      
      switch mode
        when 0 
          drawMacro(x, y, z)
        when 1 
          drawMacro(y, x, z)
        else
          drawMacro(z, y, x)

    return

  drawLine2d : (x, y, x1, y1, z) ->
    # Source: http://en.wikipedia.org/wiki/Bresenham's_line_algorithm#Simplification

    { shift_z, buffer } = @
    
    x_inc = if (dx = x1 - x) < 0 then -1 else 1
    y_inc = if (dy = y1 - y) < 0 then -1 else 1
     
    dx = if dx < 0 then -dx else dx
    dy = if dy < 0 then -dy else dy
     
    dx2 = dx << 1
    dy2 = dy << 1

    drawMacro(x, y, z)    

    if dx >= dy

      d = dx
      mode = 0

    else

      swapMacro(y, x)
      swapMacro(y_inc, x_inc)
      swapMacro(dy2, dx2)
      d = dy
      mode = 1

    err = dy2 - d
      
    for i in [0...d] by 1

      if err > 0
        y += y_inc
        err -= dx2
     
      err += dy2
      x   += x_inc
      
      if mode
        drawMacro(y, x, z)
      else
        drawMacro(x, y, z)

    return

  drawPolygons : ->
    # Iterates over all relevant xy-planes. The points in
    # each plane are used to build a convex polygon. The
    # edges of that polygon is then drawn into the buffer.
    # After that, we know all line segments that belong to
    # the polyhedron.

    { delta_x, delta_y, delta_z, shift_z, buffer, pointsBuffer } = @

    # build and rasterize convex hull of all xy-planes
    
    for z in [0...delta_z] by 1

      # put found end points into an ordered collection
      # ordered by (y,x)
      pointsPointer = 0
      index_y = z << shift_z
      for y in [0...delta_y] by 1
        
        if (x0 = buffer[index_y++]) != Int32_MAX
          pointsBuffer[pointsPointer++] = y
          pointsBuffer[pointsPointer++] = x0
          if (x1 = buffer[index_y++]) != x0
            pointsBuffer[pointsPointer++] = y
            pointsBuffer[pointsPointer++] = x1
        else
          index_y++

      
      # Generating convex hull by brute force. O(n²)
      i = 0
      while i < pointsPointer

        y0 = pointsBuffer[i++]
        x0 = pointsBuffer[i++]

        j = i
        while j < pointsPointer

          y1 = pointsBuffer[j++]
          x1 = pointsBuffer[j++]

          @drawLine2d(x0, y0, x1, y1, z)


    return
      

  collectPoints : ->
    
    { buffer, min_x, min_y, min_z, shift_z, delta_y, delta_z } = @

    output = []

    for z in [0...delta_z] by 1
      index = z << shift_z
      for y in [0...delta_y] by 1
        x0 = buffer[index++]
        x1 = buffer[index++]
        if x0 != Int32_MAX
          output.push x + min_x, y + min_y, z + min_z for x in [x0..x1]

    output


  collectPointsOnion : (xs, ys, zs) ->

    { buffer, min_x, max_x, min_y, max_y, min_z, max_z, delta_x, delta_y, delta_z, shift_z } = @

    maxRadius = Math.max(
      Math.abs(xs - min_x)
      Math.abs(xs - max_x)
      Math.abs(ys - min_y)
      Math.abs(ys - max_y)
      Math.abs(zs - min_z)
      Math.abs(zs - max_z)
    )

    outputBuffer = new Int32Array(HEAP, @bufferLength * Int32Array.BYTES_PER_ELEMENT, delta_x * delta_y * delta_z * 3)
    outputLength = 0

    for radius in [0..maxRadius] by 1

      radius_min_z = Math.max(zs - radius, min_z)
      radius_max_z = Math.min(zs + radius, max_z)
      radius_min_y = Math.max(ys - radius, min_y)
      radius_max_y = Math.min(ys + radius, max_y)

      if @orientation is 1
        radius_start_z = radius_max_z
        radius_end_z = radius_min_z        
      else
        radius_end_z = radius_max_z
        radius_start_z = radius_min_z
     
      for z in [radius_start_z..radius_end_z]
        for y in [radius_min_y..radius_max_y] by 1
          index = ((z - min_z) << shift_z) + ((y - min_y) << 1)
          x0 = buffer[index++]
          x1 = buffer[index++]
          if x0 != Int32_MAX
            x0 += min_x
            x1 += min_x
            for x in [Math.max(xs - radius, x0)..Math.min(xs + radius, x1)]
              if x == xs - radius or x == xs + radius or
              y == ys - radius or y == ys + radius or
              z == zs - radius or z == zs + radius
                outputBuffer[outputLength++] = x
                outputBuffer[outputLength++] = y
                outputBuffer[outputLength++] = z

    outputBuffer.subarray(0, outputLength)

class PolyhedronRasterizer.Master

  # Works just like a regular mesh in WebGL.
  constructor : (@vertices, @indices) ->

  transformAffine : (matrix) ->

    { vertices, indices } = @

    transformedPolyhdron = new PolyhedronRasterizer(
      M4x4.transformPointsAffine(matrix, vertices, new Int32Array(vertices.length)), 
      indices
    )

    orientationVector = M4x4.transformLineAffine(matrix, [0, 0, 1], [0, 0, 0])

    transformedPolyhdron.orientation = if orientationVector[2] < 0 then -1 else 1

    transformedPolyhdron


  @squareFrustum : (nearFaceXWidth, nearFaceYWidth, nearFaceZ, farFaceXWidth, farFaceYWidth, farFaceZ) ->
  
    vertices = [
      -nearFaceXWidth / 2, -nearFaceYWidth / 2, nearFaceZ #0
      -farFaceXWidth  / 2, -farFaceYWidth  / 2, farFaceZ #3
      -nearFaceXWidth / 2,  nearFaceYWidth / 2, nearFaceZ #6
      -farFaceXWidth  / 2,  farFaceYWidth  / 2, farFaceZ #9
       nearFaceXWidth / 2, -nearFaceYWidth / 2, nearFaceZ #12 
       farFaceXWidth  / 2, -farFaceYWidth  / 2, farFaceZ #15
       nearFaceXWidth / 2,  nearFaceYWidth / 2, nearFaceZ #18
       farFaceXWidth  / 2,  farFaceYWidth  / 2, farFaceZ #21
    ]
    indices = [
      0,3
      0,6
      0,12
      3,9
      3,15
      6,9
      6,18
      9,21
      12,15
      12,18
      15,21
      18,21
    ]
    new PolyhedronRasterizer.Master(vertices, indices)


  @cuboid : (width_x, width_y, width_z) ->

    @squareFrustum(width_x, width_y, 0, width_x, width_y, width_z)


  @cube : (width) ->

    @cuboid(width, width, width)



PolyhedronRasterizer
