Math.square = (a) -> a * a
Math.normalizeVector = (vec) ->
  length = Math.sqrt(vec.reduce((r, a) -> r + Math.square(a)))
  if length > 0
    vec.map((a) -> a / length)
  else
    vec