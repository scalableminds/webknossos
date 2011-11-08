Math.square = (a) -> a * a

Math.normalizeVector = (vec) ->
  length = Math.sqrt(vec.reduce(((r, a) -> r + Math.square(a)), 0))
  if length > 0
    vec.map((a) -> a / length)
  else
    vec

Math.crossProduct = (v1, v2) ->
  [
    v1[1] * v2[2] - v1[2] * v2[1]
    v1[2] * v2[0] - v1[0] * v2[2]
    v1[0] * v2[1] - v1[1] * v2[0]
  ]
    
defer = (callback) ->
  setTimeout(callback, 1)