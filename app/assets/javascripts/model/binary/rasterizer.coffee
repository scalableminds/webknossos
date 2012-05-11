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
  xx + 1

cross = (o, a, b) ->
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

crossMacro = (o0, o1, a0, a1, b0, b1) ->
  (a0 - o0) * (b1 - o1) - (a1 - o1) * (b0 - o0)

Uint32_MAX = 2147483648

class Polyhedron
  constructor : (@vertices, @indices) ->

    @calcExtent()

  transform : (matrix) ->
    new Polyhedron(
      M4x4.transformPointsAffine(matrix, @vertices, new Uint32Array(@vertices.length)), 
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

    # rasterize edges
    i = 0
    while i < indices.length
      
      i0 = indices[i++]
      i1 = indices[i++]

      line = @bresenham(
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
          zBuffer = buffer[z] = new Uint32Array(delta_y << 1)
          for k in [0...zBuffer.length] by 2
            zBuffer[k] = Uint32_MAX

        zBuffer[y]     = x if x < zBuffer[y]
        zBuffer[y + 1] = x if x > zBuffer[y + 1]

    # build and rasterize convex hull of all z-planes
    points = new Uint32Array(delta_y << 2)
    lower  = new Uint32Array(delta_y << 2)
    upper  = new Uint32Array(delta_y << 2)
    for zBuffer, z in buffer
      pointsPointer = 0
      for y in [0...delta_y]
        if (x0 = zBuffer[y << 1]) != Uint32_MAX
          points[pointsPointer++] = y
          points[pointsPointer++] = x0
          if (x1 = zBuffer[(y << 1) + 1]) != x0
            points[pointsPointer++] = y
            points[pointsPointer++] = x1

      lowerPointer = 0
      i = 0
      while i < pointsPointer
        points_1 = points[i++]
        points_2 = points[i++]
        lower_4 = lower[lowerPointer - 4]
        lower_3 = lower[lowerPointer - 3]
        lower_2 = lower[lowerPointer - 2]
        lower_1 = lower[lowerPointer - 1]
        while lowerPointer >= 4 and 
        (crossMacro(lower_4, lower_3, lower_2, lower_1, points_1, points_2)) <= 0
          lowerPointer -= 2
          lower_4 = [lowerPointer - 2]
          lower_3 = [lowerPointer - 1]
          lower_2 = lower_4
          lower_1 = lower_3

        lower[lowerPointer++] = points_1
        lower[lowerPointer++] = points_2

      lower1 = []
      i = 0
      while i < pointsPointer
        p = [points[i++], points[i++]]
        while lower1.length >= 2 and cross(lower1[lower1.length - 2], lower1[lower1.length - 1], p) <= 0
          lower1.pop()
        lower1.push(p)

      throw "bla" unless lower1.length == lowerPointer / 2


      upperPointer = 0
      i = pointsPointer
      while i 
        points_2 = points[--i]
        points_1 = points[--i]
        upper_4 = upper[upperPointer - 4]
        upper_3 = upper[upperPointer - 3]
        upper_2 = upper[upperPointer - 2]
        upper_1 = upper[upperPointer - 1]
        while upperPointer >= 4 and 
        (crossMacro(upper_4, upper_3, upper_2, upper_1, points_1, points_2)) <= 0
          upperPointer -= 2
          upper_4 = [upperPointer - 2]
          upper_3 = [upperPointer - 1]
          upper_2 = upper_4
          upper_1 = upper_3

        upper[upperPointer++] = points_1
        upper[upperPointer++] = points_2

      upper1 = []
      i = pointsPointer
      while i
        p = [points[--i], points[--i]].reverse()
        while upper1.length >= 2 and cross(upper1[upper1.length - 2], upper1[upper1.length - 1], p) <= 0
          upper1.pop()
        upper1.push(p)

      throw "bla" unless upper1.length == upperPointer / 2

      hull = lower.slice(0, -1).concat(upper.slice(0, -1))
      output.push @rasterizeHull(hull, zBuffer, z + min_z)...

        
    output

    # rasterize all points in between

    # done

    #buffer

  rasterizeHull : (hull, buffer, z) ->

    output = []

    console.time("rasterizePolygon")

    # Step 3: go through all the lines in this polygon and build min/max x array.
    i = j = 0
    while i < hull.length
      y0 = hull[i][0]
      x0 = hull[i++][1]
      
      j = i % hull.length # last line will link last vertex with the first (index num-1 to 0)

      y1 = hull[j][0] 
      x1 = hull[j][1]
      
      if y1 - y0
        # initializing current line data (see tutorial on line rasterization for details)

        dx = x1 - x0
        dy = y1 - y0

        if dx >= 0
          incXH = incXL = 1
        else
          dx = -dx
          incXH = incXL = -1

        if dy >= 0
          incYH = incYL = 1
        else
          dy = -dy
          incYH = incYL = -1

        if dx >= dy
          longD = dx
          shortD = dy
          incYL = 0
        else
          longD = dy
          shortD = dx
          incXL = 0

        d = (shortD << 1) - longD;
        incDL = shortD << 1;
        incDH = (shortD << 1) - (longD << 1);

        for j in [0..longD] # step through the current line and remember min/max values at each y
          ind = y0 << 1
          buffer[ind]     = x0 if x0 < buffer[ind] #initial contains INT_MAX so any value is less
          buffer[ind + 1] = x0 if x0 > buffer[ind + 1] # initial contains INT_MIN so any value is greater
          # finding next point on the line ...
          if d >= 0
            x0 += incXH
            y0 += incYH
            d += incDH
          else
            x0 += incXL
            y0 += incYL
            d += incDL
    
    # Step 4: drawing horizontal line for each y from small_x to large_x including.
    for i in [0...@delta_y] when buffer[i << 1] != Uint32_MAX
      for j in [buffer[i << 1]..buffer[(i << 1) + 1]]
        output.push j, i + @min_y, z
    console.timeEnd("rasterizePolygon")
    output

  rasterizePolygon : (vertices) ->

    output = []

    console.time("rasterizePolygon")
    vertices = new Int32Array(vertices)
    
    # Step 1: find small and large y's of all the vertices
    min_y = max_y = vertices[1]

    for i in [3...vertices.length] by 2
      y = vertices[i]
      if y < min_y
        min_y = y 
      else if y > max_y
        max_y = y 

    # Step 2: array that contains small_x and large_x values for each y.
    delta_y = max_y - min_y + 1
    scanLine = new Uint32Array(delta_y << 1)
    Uint32_MAX = 1 << 31
    for i in [1...(delta_y << 1)] by 2
      scanLine[i] = Uint32_MAX
  

    # Step 3: go through all the lines in this polygon and build min/max x array.
    i = j = 0
    while i < vertices.length
      x0 = vertices[i++]
      y0 = vertices[i++]

      j = i % vertices.length # last line will link last vertex with the first (index num-1 to 0)

      x1 = vertices[j++]
      y1 = vertices[j++] 
      
      if y1 - y0
        # initializing current line data (see tutorial on line rasterization for details)

        dx = x1 - x0
        dy = y1 - y0

        if dx >= 0
          incXH = incXL = 1
        else
          dx = -dx
          incXH = incXL = -1

        if dy >= 0
          incYH = incYL = 1
        else
          dy = -dy
          incYH = incYL = -1

        if dx >= dy
          longD = dx
          shortD = dy
          incYL = 0
        else
          longD = dy
          shortD = dx
          incXL = 0

        d = (shortD << 1) - longD;
        incDL = shortD << 1;
        incDH = (shortD << 1) - (longD << 1);

        for j in [0..longD] # step through the current line and remember min/max values at each y
          ind = (y0 - min_y) << 1
          scanLine[ind]     = x0 if x0 < scanLine[ind] #initial contains INT_MAX so any value is less
          scanLine[ind + 1] = x0 if x0 > scanLine[ind + 1] # initial contains INT_MIN so any value is greater
          # finding next point on the line ...
          if d >= 0
            x0 += incXH
            y0 += incYH
            d += incDH
          else
            x0 += incXL
            y0 += incYL
            d += incDL
    
    # Step 4: drawing horizontal line for each y from small_x to large_x including.
    for i in [0...delta_y] when scanLine[i << 1] != Uint32_MAX
      for j in [scanLine[i << 1]..scanLine[(i << 1) + 1]]
        output.push j, i + min_y
    console.timeEnd("rasterizePolygon")
    output.length


  voxelizePolyhedron : (edges) ->

    min_z = max_z = edges[2]

    for i in [5...edges.length] by 3
      z = edges[i]
      if z < min_z
        min_z = z 
      else if z > max_z
        max_z = z

    delta_z = max_z - min_z + 1
    scanPlane = new Array(delta_z)
    for i in [0...delta_z]
      scanPlane[i] = []

    i = 0
    while i < edges.length
      x0 = edges[i++]
      y0 = edges[i++]
      z0 = edges[i++]
      x1 = edges[i++]
      y1 = edges[i++]
      z1 = edges[i++]

      line = @bresenham(x0, y0, z0, x1, y1, z1)
      j = 0
      while j < line.length
        x = line[j++]
        y = line[j++]
        z = line[j++]

        scanPlane[z - min_z].push(x,y)

    output = []
    for i in [0...delta_z]
      output = output.concat(@rasterizePolygon(scanPlane[i]))

    output.length



  bresenham : (x0, y0, z0, x1, y1, z1) ->

    console.time("bresenham")
    
    output = []

    x = x0
    y = y0
    z = z0

    output.push x, y, z

    x_inc = if (dx = x1 - x0) < 0 then -1 else 1
    y_inc = if (dy = y1 - y0) < 0 then -1 else 1
    z_inc = if (dz = z1 - z0) < 0 then -1 else 1
     
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


    console.timeEnd("bresenham")
    output



  bresenham2 : (x0, y0, z0, x1, y1, z1) ->

    console.time("bresenham")
    
    output = []

    x = x0
    y = y0
    z = z0

    dx = x1 - x0
    dy = y1 - y0
    dz = z1 - z0

    x_inc = if dx < 0 then -1 else 1
    y_inc = if dy < 0 then -1 else 1
    z_inc = if dz < 0 then -1 else 1
     
    Adx = Math.abs(dx)
    Ady = Math.abs(dy)
    Adz = Math.abs(dz)
     
    dx2 = Adx << 1
    dy2 = Ady << 1
    dz2 = Adz << 1

    if Adx >= Ady and Adx >= Adz
      
      bresenhamCoreMacro(x, y, z, x_inc, y_inc, z_inc, dx2, dy2, dz2, Adx)
      err_1 = dy2 - Adx
      err_2 = dz2 - Adx
        
      for Cont in [0...Adx]
         
        if err_1 > 0
          y += y_inc
          err_1 -= dx2
        if err_2 > 0
          z += z_inc
          err_2 -= dx2
       
        err_1 += dy2
        err_2 += dz2
        x     += x_inc
       
        output.push x, y, z
     
    if Ady > Adx and Ady >= Adz
      
      bresenhamCoreMacro(y, x, z, y_inc, x_inc, z_inc, dy2, dx2, dz2, Ady)
      err_1 = dx2 - Ady
      err_2 = dz2 - Ady

      for Cont in [0...Ady]
        
        if err_1 > 0
          x += x_inc
          err_1 -= dy2

        if err_2 > 0
          z += z_inc
          err_2 -= dy2

        err_1 += dx2
        err_2 += dz2
        y     += y_inc

        output.push x, y, z


    if Adz > Adx and Adz > Ady

      bresenhamCoreMacro(z, y, x, z_inc, y_inc, x_inc, dz2, dy2, dx2, Adz)
      err_1 = dy2 - Adz
      err_2 = dx2 - Adz

      for Cont in [0...Adz]

        if err_1 > 0
          y += y_inc
          err_1 -= dz2

        if err_2 > 0
          x += x_inc
          err_2 -= dz2

        err_1 += dy2
        err_2 += dx2
        z     += z_inc

        output.push x, y, z

    console.timeEnd("bresenham")
    output

->
  vertices = [
    0 ,0 ,0  #0
    3 ,3 ,12 #3
    0 ,12,0  #6
    3 ,15,12 #9
    12,0 ,0  #12 
    15,3 ,12 #15
    12,12,0  #18
    15,15,12 #21
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
  console.profile "voxelize"
  o = new Polyhedron(vertices, indices).voxelize()
  console.profileEnd "voxelize"
  console.log o