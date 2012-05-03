### define ###
  
class Flycam

  constructor : (distance) ->
    @defaultDistance = distance
    @zoomStep = 0   
    @reset()
    @stepBack = [0, 0, -distance]
    @stepFront = [0, 0, distance]

  reset : ->
    @currentMatrix = M4x4.clone [ 
      1, 0, 0, 0, 
      0, 1, 0, 0, 
      0, 0, 1, 0, 
      0, 0, 0, 1 
    ]

  zoomIn : ->
    @zoomStep--
    m = @currentMatrix
    m[12] = m[12] << 1 
    m[13] = m[13] << 1
    m[14] = m[14] << 1

  zoomOut : ->
    @zoomStep++
    m = @currentMatrix
    m[12] = m[12] >> 1 
    m[13] = m[13] >> 1
    m[14] = m[14] >> 1

  getZoomStep : ->
    @zoomStep   

  getMatrix : ->
    M4x4.clone @currentMatrix

  getGlobalMatrix : ->
    m = M4x4.clone @currentMatrix
    m[12] = m[12] << @zoomStep
    m[13] = m[13] << @zoomStep
    m[14] = m[14] << @zoomStep
    m
  
  setMatrix : (matrix) ->
    @currentMatrix = matrix

  move : (p) ->
    @currentMatrix = M4x4.translate([ p[0], p[1], p[2] ], @currentMatrix)
    
  getMovedNonPersistent : (p) ->
    @move [ p[0], p[1], p[2] ]
    output = M4x4.clone @currentMatrix
    @move [ p[0], p[1], -p[2] ]
    output

  yaw : (angle) ->
    @currentMatrix = M4x4.rotate(angle, [ 0, 1, 0 ], @currentMatrix)

  yawDistance : (angle) ->
    @move(@stepBack)
    @currentMatrix = M4x4.rotate(angle, [ 0, 1, 0 ], @currentMatrix)
    @move(@stepFront)   

  roll : (angle) ->
    @currentMatrix = M4x4.rotate(angle, [ 0, 0, 1 ], @currentMatrix)    

  rollDistance : (angle) ->
    @move(@stepBack)
    @currentMatrix = M4x4.rotate(angle, [ 0, 0, 1 ], @currentMatrix)
    @move(@stepFront)

  pitch : (angle) ->
    currentMatrix = M4x4.rotate(angle, [ 1, 0, 0 ], @currentMatrix)

  pitchDistance : (angle) ->
    @move(@stepBack)
    @currentMatrix = M4x4.rotate(angle, [ 1, 0, 0 ], @currentMatrix)
    @move(@stepFront)

  rotateOnAxis : (angle, axis) ->
    @currentMatrix = M4x4.rotate(angle, axis, @currentMatrix) 

  rotateOnAxisDistance : (angle, axis) ->
    @move(@stepBack)
    @currentMatrix = M4x4.rotate(angle, axis, @currentMatrix)
    @move(@stepFront)

  toString : ->
    matrix = @currentMatrix
    "[" + matrix[ 0] + ", " + matrix[ 1] + ", " + matrix[ 2] + ", " + matrix[ 3] + ", " +
    matrix[ 4] + ", " + matrix[ 5] + ", " + matrix[ 6] + ", " + matrix[ 7] + ", " +
    matrix[ 8] + ", " + matrix[ 9] + ", " + matrix[10] + ", " + matrix[11] + ", " +
    matrix[12] + ", " + matrix[13] + ", " + matrix[14] + ", " + matrix[15] + "]"
  
  getPos : ->
    matrix = @currentMatrix
    [ matrix[12], matrix[13], matrix[14]]

  getGlobalPos : ->
    matrix = @currentMatrix
    [ matrix[12] << @zoomStep, matrix[13] << @zoomStep, matrix[14] << @zoomStep ]

  setPos : (p) ->
    matrix = @currentMatrix
    matrix[12] = p[0]
    matrix[13] = p[1]
    matrix[14] = p[2]

  getDir : ->
    matrix = @currentMatrix
    [ matrix[8], matrix[9], matrix[10] ]

  setDir : (p) ->
    matrix = @currentMatrix
    matrix[8]  = p[0]
    matrix[9]  = p[1]
    matrix[10] = p[2]

  getUp : ->
    matrix = @currentMatrix
    [ matrix[4], matrix[5], matrix[6] ]

  getLeft : ->
    matrix = @currentMatrix
    [ matrix[0], matrix[1], matrix[2] ]
