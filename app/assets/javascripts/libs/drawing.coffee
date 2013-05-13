### define ###

# This is a class with static methods and constants dealing with drawing
# lines and filling polygons

# Macros
swapMacro = (a, b) ->
  __tmp = a
  a = b
  b = __tmp

# Constants
SMOOTH_LENGTH = 4
SMOOTH_ALPHA  = 0.2

Drawing =

  # Source: http://en.wikipedia.org/wiki/Bresenham's_line_algorithm#Simplification
  drawLine2d : (x, y, x1, y1, draw) ->
    
    x_inc = if (dx = x1 - x) < 0 then -1 else 1
    y_inc = if (dy = y1 - y) < 0 then -1 else 1
     
    dx = Math.abs(dx)
    dy = Math.abs(dy)
     
    dx2 = dx << 1
    dy2 = dy << 1

    draw(x, y)    

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
        draw(y, x)
      else
        draw(x, y)

    return

  # Source: http://will.thimbleby.net/scanline-flood-fill/
  fillArea : (x, y, width, height, diagonal, test, paint) ->

    # xMin, xMax, y, down[true] / up[false], extendLeft, extendRight
    ranges = [[x, x, y, null, true, true]]
    paint(x, y)
    while ranges.length
      
      addNextLine = (newY, isNext, downwards) ->
        rMinX = minX
        inRange = false
        x = minX

        while x <= maxX
          
          # skip testing, if testing previous line within previous range
          empty = (isNext or (x < r[0] or x > r[1])) and test(x, newY)
          if not inRange and empty
            rMinX = x
            inRange = true
          else if inRange and not empty
            ranges.push [rMinX, x - 1, newY, downwards, rMinX is minX, false]
            inRange = false
          paint(x, newY)  if inRange
          
          # skip
          x = r[1]  if not isNext and x is r[0]
          x++
        ranges.push [rMinX, x - 1, newY, downwards, rMinX is minX, true]  if inRange

      r = ranges.pop()
      minX = r[0]
      maxX = r[1]
      y = r[2]
      down = r[3] is true
      up = r[3] is false
      extendLeft = r[4]
      extendRight = r[5]
      if extendLeft
        while minX > 0 and test(minX - 1, y)
          minX--
          paint(minX, y)
      if extendRight
        while maxX < width - 1 and test(maxX + 1, y)
          maxX++
          paint(maxX, y)
      if diagonal
        minX--  if minX > 0
        maxX++  if maxX < width - 1
      else
        r[0]--
        r[1]++
      addNextLine y + 1, not up, true  if y < height
      addNextLine y - 1, not down, false  if y > 0  

  # Source : http://twistedoakstudios.com/blog/Post3138_mouse-path-smoothing-for-jack-lumber
  smoothLine : (points, callback) ->

    smoothLength = @smoothLength || SMOOTH_LENGTH
    a            = @alpha || SMOOTH_ALPHA

    if points.length > 2 + smoothLength
      
      for i in [0...smoothLength] 
        
        j = points.length-i-2
        p0 = points[j] 
        p1 = points[j+1] 

        p = []
        for k in [0...p0.length]
          p.push(p0[k] * (1-a) + p1[k] * a)

        callback(p)
        points[j] = p

    return points

  setSmoothLength : (v) -> @smoothLength = v
  setAlpha : (v) -> @alpha = v