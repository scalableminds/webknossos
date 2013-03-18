### define ###

# This is a class with static methods and constants dealing with drawing
# lines and filling polygons

# Macros
swapMacro = (a, b) ->
  __tmp = a
  a = b
  b = __tmp

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