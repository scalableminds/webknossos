Math.square = (a) -> a * a

Math.normalizeVector = (vec) ->
  length = Math.vecLength(vec)
  if length > 0
    vec.map((a) -> a / length)
  else
    vec

Math.dotProduct = (v1, v2) ->
  return null if v1.length != v2.length
  v1.reduce(((r, a, i) -> r + a * v2[i]), 0)

Math.crossProduct = (v1, v2) ->
  [
    v1[1] * v2[2] - v1[2] * v2[1]
    v1[2] * v2[0] - v1[0] * v2[2]
    v1[0] * v2[1] - v1[1] * v2[0]
  ]

Math.vecAngle = (v1, v2) ->
  Math.dotProduct(v1, v2) / (Math.vecLength(v1) * Math.vecLength(v2))

Math.vecAngleIsReflex = (v1, v2) ->
  Math.dotProduct(v2, Math.crossProduct(v1, Math.crossProduct(v1, v2)))

Math.vecLength = (vec) ->
  Math.sqrt(vec.reduce(((r, a) -> r + Math.square(a)), 0))

Array::equals = (other) ->
  return false if @length != other.length
  for i in [0...@length]
    return false if @[i] != other[i]
  true

Array::cmp = (other) ->
  if @length != other.length
    if @length < other.length then -1 else 1
  else
    for i in [0...@length]
      if @[i] < other[i]
        return -1
      if @[i] > other[i]
        return 1
    0
    
defer = (callback) ->
  setTimeout(callback, 1)