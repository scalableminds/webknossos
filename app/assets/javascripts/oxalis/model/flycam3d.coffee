_           = require("lodash")
THREE       = require("three")
{M4x4, V3}  = require("libs/mjs")

updateMacro = (_this) ->

  _this.trigger("changed", _this.currentMatrix, _this.zoomStep)
  _this.hasChanged = true


transformationWithDistanceMacro = (_this, transformationFn, transformationArg1, transformationArg2) ->

  { currentMatrix } = _this
  M4x4.translate(_this.distanceVecNegative, currentMatrix, currentMatrix)
  transformationFn.call(_this, transformationArg1, transformationArg2)
  M4x4.translate(_this.distanceVecPositive, currentMatrix, currentMatrix)
  return

class Flycam3d

  ZOOM_STEP_INTERVAL : 1.1
  ZOOM_STEP_MIN : 0.5
  ZOOM_STEP_MAX : 5

  zoomStep : 1.3
  hasChanged : true
  scale : null
  currentMatrix : null

  constructor : (@distance, scale) ->

    _.extend(this, Backbone.Events)

    @scale = @calculateScaleValues(scale)

    @reset()
    @calculateDistanceVectors(@zoomStep)


  calculateDistanceVectors : (zoomStep = 1) ->
    @distanceVecNegative = [0, 0, -zoomStep * @distance]
    @distanceVecPositive = [0, 0, zoomStep * @distance]


  calculateScaleValues : (scale) ->

    scale = [1/scale[0], 1/scale[1], 1/scale[2]]
    maxScale = Math.max(scale[0], scale[1], scale[2])
    multi = 1/maxScale
    scale = [multi * scale[0], multi * scale[1], multi * scale[2]]
    return scale


  reset : (resetPosition = true) ->

    { scale } = @
    if @currentMatrix?
      position = @currentMatrix[12..14]

    m = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]
    M4x4.scale(scale, m, m)
    @currentMatrix = m

    if position? and not resetPosition
      @setPosition(position)

    # Apply 180° Rotation to keep it consistent with plane view
    @roll(Math.PI)

    updateMacro(this)


  update : ->

    updateMacro(this)


  flush : ->

    if @hasChanged
      @hasChanged = false
      true
    else
      false


  zoomIn : ->

    @zoomStep = Math.max(@zoomStep / @ZOOM_STEP_INTERVAL, @ZOOM_STEP_MIN)
    @calculateDistanceVectors(@zoomStep)
    updateMacro(this)


  zoomOut : ->

    @zoomStep = Math.min(@zoomStep * @ZOOM_STEP_INTERVAL, @ZOOM_STEP_MAX)
    @calculateDistanceVectors(@zoomStep)
    updateMacro(this)


  getZoomStep : ->

    return @zoomStep


  setZoomStep : (zoomStep) ->

    @zoomStep = Math.min(@ZOOM_STEP_MAX, Math.max(@ZOOM_STEP_MIN, zoomStep))


  getMatrix : ->

    return M4x4.clone(@currentMatrix)


  getZoomedMatrix : ->

    matrix = @getMatrix()
    return M4x4.scale1(@zoomStep, matrix, matrix)


  setMatrix : (matrix) ->

    @currentMatrix = M4x4.clone(matrix)
    updateMacro(this)


  move : (vector) ->

    M4x4.translate(vector, @currentMatrix, @currentMatrix)
    updateMacro(this)


  yaw : (angle, regardDistance = false) ->

    if regardDistance
      transformationWithDistanceMacro(this, @yawSilent, angle)
    else
      @yawSilent(angle)
    updateMacro(this)


  yawSilent : (angle) ->

    @rotateOnAxisSilent(angle, [ 0, 1, 0 ])


  roll : (angle, regardDistance = false) ->

    if regardDistance
      transformationWithDistanceMacro(this, @rollSilent, angle)
    else
      @rollSilent(angle)
    updateMacro(this)


  rollSilent : (angle) ->

    @rotateOnAxisSilent(angle, [ 0, 0, 1 ])


  pitch : (angle, regardDistance = false) ->

    if regardDistance
      transformationWithDistanceMacro(this, @pitchSilent, angle)
    else
      @pitchSilent(angle)
    updateMacro(this)


  pitchSilent : (angle) ->

    @rotateOnAxisSilent(angle, [ 1, 0, 0 ])


  rotateOnAxis : (angle, axis) ->

    @rotateOnAxisSilent(angle, axis)
    updateMacro(this)


  rotateOnAxisSilent : (angle, axis) ->

    M4x4.rotate(angle, axis, @currentMatrix, @currentMatrix)


  rotateOnAxisDistance : (angle, axis) ->

    transformationWithDistanceMacro(this, @rotateOnAxisSilent, angle, axis)
    updateMacro(this)


  toString : ->

    matrix = @currentMatrix
    return "[" + matrix[ 0] + ", " + matrix[ 1] + ", " + matrix[ 2] + ", " + matrix[ 3] + ", " +
      matrix[ 4] + ", " + matrix[ 5] + ", " + matrix[ 6] + ", " + matrix[ 7] + ", " +
      matrix[ 8] + ", " + matrix[ 9] + ", " + matrix[10] + ", " + matrix[11] + ", " +
      matrix[12] + ", " + matrix[13] + ", " + matrix[14] + ", " + matrix[15] + "]"


  getPosition : ->

    matrix = @currentMatrix
    return [ matrix[12], matrix[13], matrix[14] ]


  getRotation : ->

    object = new THREE.Object3D()
    matrix = (new THREE.Matrix4()).fromArray( @currentMatrix ).transpose()
    object.applyMatrix( matrix )

    # Fix JS modulo bug
    # http://javascript.about.com/od/problemsolving/a/modulobug.htm
    mod = (x, n) ->
      return ((x % n) + n) % n

    return _.map [
      object.rotation.x
      object.rotation.y
      object.rotation.z - Math.PI
      ], (e) -> mod(180 / Math.PI * e, 360)



  setPositionSilent : (p) ->

    matrix = @currentMatrix
    matrix[12] = p[0]
    matrix[13] = p[1]
    matrix[14] = p[2]


  setPosition : (p) ->

    @setPositionSilent(p)
    updateMacro(this)


  setRotation : ([x, y, z]) ->

    @reset(false)
    @roll  -z * Math.PI / 180
    @yaw   -y * Math.PI / 180
    @pitch -x * Math.PI / 180


  getCurrentUpVector : ->

    currentRotation = new THREE.Matrix4()
    currentRotation.extractRotation(new THREE.Matrix4(@currentMatrix...))
    up = new THREE.Vector3(0, 1, 0)
    up.applyMatrix4(currentRotation)

    return up


  convertToJsArray : (floatXArray) ->

    return Array.prototype.slice.call(floatXArray)


  getUp : ->

    matrix = @currentMatrix
    return [ matrix[4], matrix[5], matrix[6] ]


  getLeft : ->

    matrix = @currentMatrix
    return [ matrix[0], matrix[1], matrix[2] ]

module.exports = Flycam3d
