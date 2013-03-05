### define 
libs/event_mixin : EventMixin
m4x4 : M4x4
underscore : _
###

updateMacro = (a) ->

  @trigger("changed", @currentMatrix)
  @hasChanged = true

transformationWithDistanceMacro = (transformation) ->
  
  { currentMatrix } = @
  M4x4.translate(@distanceVecNegative, currentMatrix, currentMatrix)
  transformation
  M4x4.translate(@distanceVecPositive, currentMatrix, currentMatrix)
  updateMacro()
  

class Flycam3d

  ZOOM_STEP_INTERVAL : 1.1
  ZOOM_STEP_MIN : 0.5
  ZOOM_STEP_MAX : 10

  zoomStep : 1  
  hasChanged : true
  scale : null
  currentMatrix : null

  constructor : (@distance, scale) ->

    _.extend(this, new EventMixin())

    @scale = @calculateScaleValues(scale)

    @reset()
    @distanceVecNegative = [0, 0, -distance]
    @distanceVecPositive = [0, 0, distance]


  calculateScaleValues : (scale) ->

    scale = [1/scale[0], 1/scale[1], 1/scale[2]]  
    maxScale = Math.max(scale[0], scale[1], scale[2])
    multi = 1/maxScale
    scale = [multi * scale[0], multi * scale[1], multi * scale[2]]  
    scale


  reset : ->

    { scale } = @

    m = [ 
      1, 0, 0, 0, 
      0, 1, 0, 0, 
      0, 0, 1, 0, 
      0, 0, 0, 1 
    ]
    M4x4.scale(scale, m, m)
    @currentMatrix = m

    updateMacro()


  resetRotation : ->

    { currentMatrix } = @

    x = currentMatrix[12]
    y = currentMatrix[13]
    z = currentMatrix[14]

    @reset()
    @setPosition([x, y, z])

    updateMacro()


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


  getZoomedMatrix : ->

    matrix = @getMatrix()
    M4x4.scale1(@zoomStep, matrix, matrix)


  setMatrix : (matrix) ->

    @currentMatrix = M4x4.clone(matrix)
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


  setPositionSilent : (p) ->

    matrix = @currentMatrix
    matrix[12] = p[0]
    matrix[13] = p[1]
    matrix[14] = p[2]


  setPosition : (p) ->

    @setPositionSilent(p)
    updateMacro()


  getDirection : ->

    matrix = @currentMatrix
    [ matrix[8], matrix[9], matrix[10] ]


  setDirection : (d) ->

    matrix = @currentMatrix
    matrix[8] = d[0]
    matrix[9] = d[1]
    matrix[10] = d[2]

  getUp : ->

    matrix = @currentMatrix
    [ matrix[4], matrix[5], matrix[6] ]


  getLeft : ->

    matrix = @currentMatrix
    [ matrix[0], matrix[1], matrix[2] ]
