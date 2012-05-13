### define ###

swapMacro = (a, b) ->
  tmp = a
  a = b
  b = tmp

nextPow2Macro = (x) ->
  --x
  x |= x >> 1
  x |= x >> 2
  x |= x >> 4
  x |= x >> 8
  x |= x >> 16
  x + 1

cross = (o, a, b) ->
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

crossMacro = (o0, o1, a0, a1, b0, b1) ->
  (a0 - o0) * (b1 - o1) - (a1 - o1) * (b0 - o0)

Uint32_MAX = 1073741824

class Polyhedron
  constructor : (@vertices, @indices) ->

    @calcExtent()

  transform : (matrix) ->
    new Polyhedron(
      M4x4.transformPointsAffine(matrix, @vertices, new Int32Array(@vertices.length)), 
      @indices
    )

  calcExtent : ->
    
    min_x = min_y = min_z = Infinity
    max_x = max_y = max_z = -Infinity

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


  voxelize : ->

    { min_x, min_y, min_z, max_x, max_y, max_z, delta_x, delta_y, delta_z, indices, vertices } = @

    buffer = new Array(delta_z)
    output = []

    # rasterize edges with 3d bresenham
    i = 0
    while i < indices.length
      
      i0 = indices[i++]
      i1 = indices[i++]

      line = @bresenham3d(
        vertices[i0++], 
        vertices[i0++], 
        vertices[i0],
        vertices[i1++], 
        vertices[i1++], 
        vertices[i1]
      )

      j = 0
      while j < line.length
        x = line[j++]
        y = (line[j++] - min_y) << 1 
        z = line[j++] - min_z

        unless zBuffer = buffer[z]
          zBuffer = buffer[z] = new Int32Array(delta_y << 1)
          for k in [0...zBuffer.length] by 2
            zBuffer[k] = Uint32_MAX

        zBuffer[y]     = x if x < zBuffer[y]
        zBuffer[y + 1] = x if x > zBuffer[y + 1]

    # build and rasterize convex hull of all z-planes
    points = new Int32Array(delta_y << 2)
    lower  = new Int32Array(delta_y << 2)
    upper  = new Int32Array(delta_y << 2)
    
    for zBuffer, z in buffer
      # convex hull building base on:
      # http://en.wikibooks.org/wiki/Algorithm_Implementation/Geometry/Convex_hull/Monotone_chain

      # put found end points into an ordered collection
      # ordered by (y,x)
      pointsPointer = 0
      for y in [min_y..max_y]
        if (x0 = zBuffer[(y - min_y) << 1]) != Uint32_MAX
          points[pointsPointer++] = y
          points[pointsPointer++] = x0
          if (x1 = zBuffer[((y - min_y) << 1) + 1]) != x0
            points[pointsPointer++] = y
            points[pointsPointer++] = x1

      lowerPointer = 0
      i = 0
      while i < pointsPointer
        points_y = points[i++]
        points_x = points[i++]
        lower_4 = lower[lowerPointer - 4]
        lower_3 = lower[lowerPointer - 3]
        lower_2 = lower[lowerPointer - 2]
        lower_1 = lower[lowerPointer - 1]

        while lowerPointer >= 4 and 
        (crossMacro(lower_4, lower_3, lower_2, lower_1, points_y, points_x)) <= 0
          # lower.pop()
          lowerPointer -= 2
          lower_4 = [lowerPointer - 2]
          lower_3 = [lowerPointer - 1]
          lower_2 = lower_4
          lower_1 = lower_3

        # lower.push(p)
        lower[lowerPointer++] = points_y
        lower[lowerPointer++] = points_x

      # # assertion
      # lower1 = []
      # i = 0
      # while i < pointsPointer
      #   p = [points[i++], points[i++]]
      #   while lower1.length >= 2 and cross(lower1[lower1.length - 2], lower1[lower1.length - 1], p) <= 0
      #     lower1.pop()
      #   lower1.push(p)
      # throw "bla" unless lower1.length == lowerPointer / 2

      upperPointer = 0
      i = pointsPointer
      while i 
        points_x = points[--i]
        points_y = points[--i]
        upper_4 = upper[upperPointer - 4]
        upper_3 = upper[upperPointer - 3]
        upper_2 = upper[upperPointer - 2]
        upper_1 = upper[upperPointer - 1]

        while upperPointer >= 4 and 
        (crossMacro(upper_4, upper_3, upper_2, upper_1, points_y, points_x)) <= 0
          upperPointer -= 2
          upper_4 = [upperPointer - 2]
          upper_3 = [upperPointer - 1]
          upper_2 = upper_4
          upper_1 = upper_3

        upper[upperPointer++] = points_y
        upper[upperPointer++] = points_x

      # # assertion
      # upper1 = []
      # i = pointsPointer
      # while i
      #   p = [points[--i], points[--i]].reverse()
      #   while upper1.length >= 2 and cross(upper1[upper1.length - 2], upper1[upper1.length - 1], p) <= 0
      #     upper1.pop()
      #   upper1.push(p)
      # throw "bla" unless upper1.length == upperPointer / 2

      output.push @rasterizeHull(lower, lowerPointer, upper, upperPointer, zBuffer, z + min_z)...

        
    output


  rasterizeHull : (lower, lowerPointer, upper, upperPointer, buffer, z) ->

    { min_y } = @

    output = []

    lowerPointer -= 2
    upperPointer -= 2

    # Step 3: go through all the lines in this polygon and build min/max x array.
    hullLength = lowerPointer + upperPointer
    i = j = 0
    while i < hullLength

      if i < lowerPointer 
        y = lower[i++]
        x = lower[i++]
      else
        y = upper[i++ - lowerPointer]
        x = upper[i++ - lowerPointer]
      
      j = i % hullLength # last line will link last vertex with the first (index num-1 to 0)
      
      if j < lowerPointer
        dy = lower[j++] - y
        dx = lower[j] - x
      else
        dy = upper[j++ - lowerPointer] - y
        dx = upper[j - lowerPointer] - x

      continue if -1 <= dy <= 1 # no need for interpolating any free lines
      
      # initializing current line data (see tutorial on line rasterization for details)

      line = @bresenham2d(x, y, x + dx, y + dy, z)
      j = 3
      while j < line.length - 3
        x = line[j++]
        y = (line[j] - min_y) << 1
        j += 2

        buffer[y]     = x if x < buffer[y] # initial contains INT_MAX so any value is less
        buffer[y + 1] = x if x > buffer[y + 1] # initial contains INT_MIN so any value is greater
    
    # Step 4: drawing horizontal line for each y from small_x to large_x including.
    for i in [0...@delta_y] when buffer[i << 1] != Uint32_MAX
      for j in [buffer[i << 1]..buffer[(i << 1) + 1]]
        output.push j, i + min_y, z

    output


  bresenham3d : (x, y, z, x1, y1, z1) ->
    
    output = []

    output.push x, y, z

    x_inc = if (dx = x1 - x) < 0 then -1 else 1
    y_inc = if (dy = y1 - y) < 0 then -1 else 1
    z_inc = if (dz = z1 - z) < 0 then -1 else 1
     
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
      
    for i in [0...d]

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
        when 0 then output.push x, y, z
        when 1 then output.push y, x, z
        else        output.push z, y, x

    output

  bresenham2d : (x, y, x1, y1, z) ->
    
    output = []

    output.push x, y, z

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
      
    for i in [0...d]

      if err > 0
        y += y_inc
        err -= dx2
     
      err += dy2
      x   += x_inc
      
      if mode
        output.push y, x, z
      else
        output.push x, y, z

    output

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

    p = new Polyhedron(vertices, indices).transform [
      1,0,0,0
      0,1,0,0
      0,0,1,0
      10,10,10,0
    ]
    console.time "voxelize"
    o = p.voxelize()
    console.timeEnd "voxelize"
    
    assertArrayEqual(
      Polyhedron::bresenham2d(0, 0, 3, 20, 3), 
      Polyhedron::bresenham3d(0, 0, 3, 3, 20, 3))
    o