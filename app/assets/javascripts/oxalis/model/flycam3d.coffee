_           = require("lodash")
THREE       = require("three")
{M4x4, V3}  = require("mjs")()

updateMacro = (_this) ->

  _this.trigger("changed", _this.currentMatrix, _this.zoomStep)
  _this.hasChanged = true


transformationWithDistanceMacro = (_this, transformationFn, transformationArg1, transformationArg2) ->

  { currentMatrix } = _this
  M4x4.translate(_this.distanceVecNegative, currentMatrix, currentMatrix)
  transformationFn.call(_this, transformationArg1, transformationArg2)
  M4x4.translate(_this.distanceVecPositive, currentMatrix, currentMatrix)
  updateMacro(_this)


class Flycam3d

  ZOOM_STEP_INTERVAL : 1.1
  ZOOM_STEP_MIN : 0.5
  ZOOM_STEP_MAX : 5

  zoomStep : 1
  hasChanged : true
  scale : null
  currentMatrix : null

  constructor : (@distance, scale) ->

    _.extend(this, Backbone.Events)

    @scale = @calculateScaleValues(scale)

    @reset()
    @distanceVecNegative = [0, 0, -@distance]
    @distanceVecPositive = [0, 0, @distance]


  calculateScaleValues : (scale) ->

    scale = [1/scale[0], 1/scale[1], 1/scale[2]]
    maxScale = Math.max(scale[0], scale[1], scale[2])
    multi = 1/maxScale
    scale = [multi * scale[0], multi * scale[1], multi * scale[2]]
    scale


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
    @roll Math.PI

    updateMacro(@)


  update : ->

    updateMacro(@)


  flush : ->

    if @hasChanged
      @hasChanged = false
      true
    else
      false


  zoomIn : ->

    @zoomStep = Math.max(@zoomStep / @ZOOM_STEP_INTERVAL, @ZOOM_STEP_MIN)
    updateMacro(@)


  zoomOut : ->

    @zoomStep = Math.min(@zoomStep * @ZOOM_STEP_INTERVAL, @ZOOM_STEP_MAX)
    updateMacro(@)


  getZoomStep : ->

    @zoomStep


  setZoomStep : (zoomStep) ->

    @zoomStep = Math.min @ZOOM_STEP_MAX,
                  Math.max @ZOOM_STEP_MIN, zoomStep


  getMatrix : ->

    M4x4.clone @currentMatrix


  getZoomedMatrix : ->

    matrix = @getMatrix()
    M4x4.scale1(@zoomStep, matrix, matrix)


  setMatrix : (matrix) ->

    @currentMatrix = M4x4.clone(matrix)
    updateMacro(@)


  move : (vector) ->

    M4x4.translate(vector, @currentMatrix, @currentMatrix)
    updateMacro(@)


  yaw : (angle, regardDistance = false) ->

    if regardDistance
      transformationWithDistanceMacro(@, @yawSilent, angle)
    else
      @yawSilent(angle)
    updateMacro(@)


  yawSilent : (angle) ->

    @rotateOnAxisSilent(angle, [ 0, 1, 0 ])


  roll : (angle, regardDistance = false) ->

    if regardDistance
      transformationWithDistanceMacro(@, @rollSilent, angle)
    else
      @rollSilent(angle)
    updateMacro(@)


  rollSilent : (angle) ->

    @rotateOnAxisSilent(angle, [ 0, 0, 1 ])


  pitch : (angle, regardDistance = false) ->

    if regardDistance
      transformationWithDistanceMacro(@, @pitchSilent, angle)
    else
      @pitchSilent(angle)
    updateMacro(@)


  pitchSilent : (angle) ->

    @rotateOnAxisSilent(angle, [ 1, 0, 0 ])


  rotateOnAxis : (angle, axis) ->

    @rotateOnAxisSilent(angle, axis)
    updateMacro(@)


  rotateOnAxisSilent : (angle, axis) ->

    M4x4.rotate(angle, axis, @currentMatrix, @currentMatrix)


  rotateOnAxisDistance : (angle, axis) ->

    transformationWithDistanceMacro(@, @rotateOnAxisSilent, angle, axis)


  toString : ->

    matrix = @currentMatrix
    "[" + matrix[ 0] + ", " + matrix[ 1] + ", " + matrix[ 2] + ", " + matrix[ 3] + ", " +
    matrix[ 4] + ", " + matrix[ 5] + ", " + matrix[ 6] + ", " + matrix[ 7] + ", " +
    matrix[ 8] + ", " + matrix[ 9] + ", " + matrix[10] + ", " + matrix[11] + ", " +
    matrix[12] + ", " + matrix[13] + ", " + matrix[14] + ", " + matrix[15] + "]"


  getPosition : ->

    matrix = @currentMatrix
    [ matrix[12], matrix[13], matrix[14] ]


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
    updateMacro(@)


  setRotation : ([x, y, z]) ->

    @reset(false)
    @roll  -z * Math.PI / 180
    @yaw   -y * Math.PI / 180
    @pitch -x * Math.PI / 180


  getDirection : ->

    matrix = @currentMatrix
    [ matrix[8], matrix[9], matrix[10] ]


  setDirection : (d) ->

    pos = @getPosition()

    m = new THREE.Matrix4().lookAt(new THREE.Vector3(d...),
      new THREE.Vector3(0, 0, 0),
      @getCurrentUpVector()).elements

    matrix2 = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      pos[0], pos[1], pos[2], 1
    ]

    M4x4.scale(@scale, matrix2, matrix2)

    @currentMatrix = @convertToJsArray(M4x4.mul(matrix2, m))
    updateMacro(@)


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
    [ matrix[4], matrix[5], matrix[6] ]


  getLeft : ->

    matrix = @currentMatrix
    [ matrix[0], matrix[1], matrix[2] ]

module.exports = Flycam3d
