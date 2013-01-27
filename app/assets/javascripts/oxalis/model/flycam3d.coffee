### define 
libs/event_mixin : EventMixin
m4x4 : M4x4
underscore : _
###

updateMacro = (a) ->

  @trigger("changed", true)
  @hasChanged = true

transformationWithDistanceMacro = (transformation) ->
  
  { currentMatrix } = @
  M4x4.translate(@distanceVecNegative, currentMatrix, currentMatrix)
  transformation
  M4x4.translate(@distanceVecPositive, currentMatrix, currentMatrix)
  updateMacro()
  

class Flycam3d

  ZOOM_STEP_INTERVAL : 1.1
  ZOOM_STEP_MIN : 1
  ZOOM_STEP_MAX : 10

  zoomStep : 1  
  hasChanged : true

  constructor : (@distance) ->

    @reset()
    @distanceVecNegative = [0, 0, -distance]
    @distanceVecPositive = [0, 0, distance]

    _.extend(this, new EventMixin())


  reset : ->

    @currentMatrix = [ 
      1, 0, 0, 0, 
      0, 1, 0, 0, 
      0, 0, 1, 0, 
      0, 0, 0, 1 
    ]

  resetRotation : ->

    m = @currentMatrix
    m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0; 
    m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0; 
    m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0; 
    m[15] = 1; 

  update : -> 

    updateMacro()


  flush : ->

    if @hasChanged
      @hasChanged = false
      true
    else
      false


  zoomIn : ->
    
    @zoomStep = Math.max(@zoomStep / @ZOOM_STEP_INTERVAL, @ZOOM_STEP_MIN)
    updateMacro()


  zoomOut : ->
    
    @zoomStep = Math.min(@zoomStep * @ZOOM_STEP_INTERVAL, @ZOOM_STEP_MAX)
    updateMacro()


  getZoomStep : -> 

    @zoomStep   


  getMatrix : -> 

    M4x4.clone @currentMatrix


  getServerMatrix : ->

    matrix = @getMatrix()
    matrix[14] /= 2
    matrix


  getZoomedMatrix : ->

    matrix = @getMatrix()
    M4x4.scale1(@zoomStep, matrix, matrix)


  setMatrix : (matrix) ->

    @currentMatrix = M4x4.clone(matrix)
    updateMacro()


  setServerMatrix : (matrix) ->

    @currentMatrix = M4x4.clone(matrix)
    @currentMatrix[14] *= 2
    updateMacro()


  move : (vector) ->

    M4x4.translate(vector, @currentMatrix, @currentMatrix)
    updateMacro()


  getCameraMatrix : (vector) ->

    M4x4.translate( @distanceVecPositive, @currentMatrix )
    

  yaw : (angle) ->

    @yawSilent(angle)
    updateMacro()


  yawSilent : (angle) ->

    @rotateOnAxisSilent(angle, [ 0, 1, 0 ])


  yawDistance : (angle) ->

    transformationWithDistanceMacro(@yawSilent(angle)) 


  roll : (angle) ->

    @rollSilent(angle)
    updateMacro()


  rollSilent : (angle) ->

    @rotateOnAxisSilent(angle, [ 0, 0, 1 ])


  rollDistance : (angle) ->

    transformationWithDistanceMacro(@rollSilent(angle))


  pitch : (angle) ->

    @pitchSilent(angle)
    updateMacro()


  pitchSilent : (angle) ->

    @rotateOnAxisSilent(angle, [ 1, 0, 0 ])


  pitchDistance : (angle) ->

    transformationWithDistanceMacro(@pitchSilent(angle))


  rotateOnAxis : (angle, axis) ->

    @rotateOnAxisSilent(angle, axis)
    updateMacro()


  rotateOnAxisSilent : (angle, axis) ->

    M4x4.rotate(angle, axis, @currentMatrix, @currentMatrix)


  rotateOnAxisDistance : (angle, axis) ->

    transformationWithDistanceMacro(@rotateOnAxisSilent(angle, axis))


  toString : ->

    matrix = @currentMatrix
    "[" + matrix[ 0] + ", " + matrix[ 1] + ", " + matrix[ 2] + ", " + matrix[ 3] + ", " +
    matrix[ 4] + ", " + matrix[ 5] + ", " + matrix[ 6] + ", " + matrix[ 7] + ", " +
    matrix[ 8] + ", " + matrix[ 9] + ", " + matrix[10] + ", " + matrix[11] + ", " +
    matrix[12] + ", " + matrix[13] + ", " + matrix[14] + ", " + matrix[15] + "]"


  getPosition : ->

    matrix = @currentMatrix
    [ matrix[12], matrix[13], matrix[14]]


  getServerPosition : ->

    position = @getPosition()
    position[2] /= 2
    position


  setPosition : (p) ->

    matrix = @currentMatrix
    matrix[12] = p[0]
    matrix[13] = p[1]
    matrix[14] = p[2]


  getDirection : ->

    matrix = @currentMatrix
    [ matrix[8], matrix[9], matrix[10] ]


  getUp : ->

    matrix = @currentMatrix
    [ matrix[4], matrix[5], matrix[6] ]


  getLeft : ->

    matrix = @currentMatrix
    [ matrix[0], matrix[1], matrix[2] ]
