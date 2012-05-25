### define ###

HEAP = new ArrayBuffer(1 << 26)
Int32_MIN = -2147483648
Int32_MAX = 2147483647

swapMacro = (a, b) ->
  tmp = a
  a = b
  b = tmp

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

crossMacro = (o0, o1, a0, a1, b0, b1) ->
  (a0 - o0) * (b1 - o1) - (a1 - o1) * (b0 - o0)

class PolyhedronRasterizer
  
  constructor : (@vertices, @indices) ->
    
    @calcExtent()
    { min_x, min_y, min_z, delta_z, delta_y, shift_z } = @

    buffer = @buffer = new Int32Array(HEAP, 0, delta_z << shift_z)

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
    @shift_z = nextFreeBit(@delta_y << 1)

    return


  transform : (matrix) ->
    
    { min_x, min_y, min_z } = @
    matrix[12] += min_x
    matrix[13] += min_y
    matrix[14] += min_z

    new_polyhedron = new PolyhedronRasterizer(
      M4x4.transformPointsAffine(matrix, @vertices, new Int32Array(@vertices.length)), 
      @indices
    )

    matrix[12] -= min_x
    matrix[13] -= min_y
    matrix[14] -= min_z

    new_polyhedron


  draw : (x, y, z) ->
    
    { buffer, shift_z } = @
    index_y = (z << shift_z) + (y << 1)

    buffer[index_y]     = x if x < buffer[index_y]
    buffer[index_y + 1] = x if x > buffer[index_y + 1]

    return


  prepare : ->

    @drawEdges()
    @drawPolygons()


  drawEdges : ->

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
    
    x_inc = if (dx = x1 - x) < 0 then -1 else 1
    y_inc = if (dy = y1 - y) < 0 then -1 else 1
    z_inc = if (dz = z1 - z) < 0 then -1 else 1
    
    @draw(x, y, z)
    
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
          @draw(x, y, z)
        when 1 
          @draw(y, x, z)
        else
          @draw(z, y, x)

    return


  drawLine2d : (x, y, x1, y1, z) ->
    
    x_inc = if (dx = x1 - x) < 0 then -1 else 1
    y_inc = if (dy = y1 - y) < 0 then -1 else 1
     
    dx = if dx < 0 then -dx else dx
    dy = if dy < 0 then -dy else dy
     
    dx2 = dx << 1
    dy2 = dy << 1
    

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
        @draw(y, x, z)
      else
        @draw(x, y, z)

    return


  drawPolygons : ->

    { delta_x, delta_y, delta_z, shift_z, buffer } = @

    # build and rasterize convex hull of all z-planes
    pointsBuffer = new Int32Array(delta_y << 2)
    lowerBuffer  = new Int32Array(delta_y << 2)
    upperBuffer  = new Int32Array(delta_y << 2)
    
    for z in [0...delta_z] by 1
      # convex hull building based on:
      # http://en.wikibooks.org/wiki/Algorithm_Implementation/Geometry/Convex_hull/Monotone_chain

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

      lowerPointer = 0
      i = 0
      while i < pointsPointer
        points_y = pointsBuffer[i++]
        points_x = pointsBuffer[i++]
        lower_4 = lowerBuffer[lowerPointer - 4]
        lower_3 = lowerBuffer[lowerPointer - 3]
        lower_2 = lowerBuffer[lowerPointer - 2]
        lower_1 = lowerBuffer[lowerPointer - 1]

        while lowerPointer >= 4 and 
        (crossMacro(lower_4, lower_3, lower_2, lower_1, points_y, points_x)) <= 0
          # lower.pop()
          lowerPointer -= 2
          lower_4 = lowerBuffer[lowerPointer - 2]
          lower_3 = lowerBuffer[lowerPointer - 1]
          lower_2 = lower_4
          lower_1 = lower_3

        # lower.push(p)
        lowerBuffer[lowerPointer++] = points_y
        lowerBuffer[lowerPointer++] = points_x

      # # assertion
      # lower1 = []
      # i = 0
      # while i < pointsPointer
      #   p = [pointsBuffer[i++], pointsBuffer[i++]]
      #   while lower1.length >= 2 and cross(lower1[lower1.length - 2], lower1[lower1.length - 1], p) <= 0
      #     lower1.pop()
      #   lower1.push(p)

      upperPointer = 0
      i = pointsPointer
      while i 
        points_x = pointsBuffer[--i]
        points_y = pointsBuffer[--i]
        upper_4 = upperBuffer[upperPointer - 4]
        upper_3 = upperBuffer[upperPointer - 3]
        upper_2 = upperBuffer[upperPointer - 2]
        upper_1 = upperBuffer[upperPointer - 1]

        while upperPointer >= 4 and 
        (crossMacro(upper_4, upper_3, upper_2, upper_1, points_y, points_x)) <= 0
          upperPointer -= 2
          upper_4 = upperBuffer[upperPointer - 2]
          upper_3 = upperBuffer[upperPointer - 1]
          upper_2 = upper_4
          upper_1 = upper_3

        upperBuffer[upperPointer++] = points_y
        upperBuffer[upperPointer++] = points_x

      # # assertion
      # upper1 = []
      # i = pointsPointer
      # while i
      #   p = [pointsBuffer[--i], pointsBuffer[--i]].reverse()
      #   while upper1.length >= 2 and cross(upper1[upper1.length - 2], upper1[upper1.length - 1], p) <= 0
      #     upper1.pop()
      #   upper1.push(p)

      lowerPointer -= 2
      upperPointer -= 2

      hull = new Int32Array(lowerPointer + upperPointer)

      for i in [0...lowerPointer] by 1
        hull[i] = lowerBuffer[i]
      for i in [0...upperPointer] by 1
        hull[i + lowerPointer] = upperBuffer[i]
      
      # Step 3: go through all the lines in this polygon and build min/max x array.
      i = j = 0
      hullLength = lowerPointer + upperPointer
      while i < hullLength

        y = hull[i++]
        x = hull[i++]
        
        j = i % hullLength # last line will link last vertex with the first (index num-1 to 0)
        
        dy = hull[j++] - y
        
        continue if -1 <= dy <= 1 # no need for interpolating any free lines

        dx = hull[j] - x
        
        # initializing current line data (see tutorial on line rasterization for details)

        @drawLine2d(x, y, x + dx, y + dy, z)

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
    output = []
    for radius in [0..maxRadius] by 1
      for z in [Math.max(zs - radius, min_z)..Math.min(zs + radius, max_z)] by 1
        for y in [Math.max(ys - radius, min_y)..Math.min(ys + radius, max_y)] by 1
          index = ((z - min_z) << shift_z) + ((y - min_z) << 1)
          x0 = buffer[index++]
          x1 = buffer[index++]
          if x0 != Int32_MAX
            x0 += min_x
            x1 += min_x
            for x in [Math.max(xs - radius, x0)..Math.min(xs + radius, x1)]
              if x == xs - radius or x == xs + radius or
              y == ys - radius or y == ys + radius or
              z == zs - radius or z == zs + radius
                output.push x, y, z
    output


  collectPointsCiruclar : (startPoint) ->
    # output = [[0, 0, 0, 0, 0]]
    q++

    for size in [1..maxSize] by 1

      z_dir = -1
      z = 0

      while z <= size

        z_abs = if z < 0 then -z else z
        _size = size - z_abs

        if _size
          x = -_size
          y = 0

          x_dir = 1
          y_dir = -1

          for i in [0...(_size << 2)] by 1

            # output.push [x, y, z, size, _size]
            q++

            x += x_dir
            y += y_dir

            if (x == _size or x == -_size) 
              x_dir = ~(--x_dir)
            if (y == _size or y == -_size) 
              y_dir = ~(--y_dir)
        else
          # output.push [0, 0, z, size, _size]
          q++

        z += z_dir
        z_dir = ~(--z_dir)

    # output
    console.timeEnd "circle"
    q

  @test : ->
  
    assertArrayEqual = (a, b) ->
      throw "wrong length" unless a.length == b.length
      for i in [0...a.length]
        throw "wrong elements" unless a[i] == b[i]
      console.log "arrays are equal"

    vertices = [
      -3,-3,-2 #0
      -3,-3, 3 #3
      -3, 3,-2 #6
      -3, 3, 3 #9
       3,-3,-2 #12 
       3,-3, 3 #15
       3, 3,-2 #18
       3, 3, 3 #21
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

    p = new PolyhedronRasterizer(vertices, indices).transform [
      1,0,0,0
      0,1,0,0
      0,0,1,0
      10,10,10,0
    ]
    console.time "voxelize"
    p.prepare()
    o = p.collectPointsOnion(10, 10, 8)
    console.timeEnd "voxelize"
    o
