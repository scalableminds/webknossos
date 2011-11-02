Math.square = (a) -> a * a

Math.normalizeVector = (vec) ->
  length = Math.sqrt(vec.reduce(((r, a) -> r + Math.square(a)), 0))
  if length > 0
    vec.map((a) -> a / length)
  else
    vec
    
defer = (callback) ->
  setTimeout(callback, 1)