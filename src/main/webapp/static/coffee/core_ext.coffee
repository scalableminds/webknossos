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

Math.vecAngleIsntReflex = (v1, v2, ref) ->
  Utils.arrayEquals(Math.normalizeVector(Math.crossProduct(v1, v2)), ref)

Math.vecLength = (vec) ->
  Math.sqrt(vec.reduce(((r, a) -> r + Math.square(a)), 0))
  
Math.absMin = (a, b) ->
  if Math.abs(a) < Math.abs(b)
    a
  else
    b
Math.normalize = (a) ->
  if a > 0 then 1 else if a < 0 then -1 else 0

Utils = 
  arrayEquals: (a1, a2) ->
    return false if a1.length != a1.length
    for i in [0...a1.length]
      return false if a1[i] != a2[i]
    true

  arrayCompare: (a1, a2) ->
    if a1.length != a2.length
      if a1.length < a2.length then -1 else 1
    else
      for i in [0...a1.length]
        if a1[i] < a2[i]
          return -1
        if a1[i] > a2[i]
          return 1
      0
  arrayMin: (arr, comparer) ->
    arr.reduce((r, a) -> 
      if comparer
        if comparer(r, a) < 0 then r else a
      else
        Math.min(r, a)
    , 0)
  
  arrayMax: (arr, comparer) ->
    arr.reduce((r, a) -> 
      if comparer
        if comparer(r, a) < 0 then r else a
      else
        Math.min(r, a)
    , 0)
  
  arrayMinMax: (arr, comparer) ->
    min = max = arr[0]
    for i in [0...arr.length]
      if comparer
        min = if comparer(min, a) < 0 then min else a
        max = if comparer(max, a) > 0 then max else a
      else
        min = Math.min(min, a)
        max = Math.max(max, a)
    [min, max]
  
  arrayUnique: (arr) ->
    output = []
    for el, i in arr
      output.push el if arr.indexOf(el) == i
    output
        
  
  defer: (callback) ->
    setTimeout(callback, 1)