app        = require("app")
Backbone   = require("backbone")
Model      = require("../model")
View       = require("../view")
Dimensions = require("../model/dimensions")
constants  = require("../constants")
THREE      = require("three")
TWEEN      = require("tween.js")

class CameraController

  # The Sceleton View Camera Controller handles the orthographic camera which is looking at the Skeleton
  # View. It provides methods to set a certain View (animated).

  cameras : null
  flycam : null
  model : null

  constructor : (@cameras, @flycam, @model) ->

    _.extend(this, Backbone.Events)

    app.vent.on(
      centerTDView : => @centerTDView()
    )

    @updateCamViewport()
    for cam in @cameras
      cam.near = -1000000
      cam.far  =  1000000

    @changeTDViewDiagonal(false)

    @bindToEvents()

  update : =>
    gPos = @flycam.getPosition()
    # camera porition's unit is nm, so convert it.
    cPos = app.scaleInfo.voxelToNm(gPos)
    @cameras[constants.PLANE_XY].position = new THREE.Vector3(cPos[0], cPos[1], cPos[2])
    @cameras[constants.PLANE_YZ].position = new THREE.Vector3(cPos[0], cPos[1], cPos[2])
    @cameras[constants.PLANE_XZ].position = new THREE.Vector3(cPos[0], cPos[1], cPos[2])


  changeTDView : (id, animate = true) ->
    camera = @cameras[constants.TDView]
    b = app.scaleInfo.voxelToNm(@model.upperBoundary)

    pos = app.scaleInfo.voxelToNm(@model.flycam.getPosition())
    time = 800
    to = {}
    notify = => @trigger("cameraPositionChanged")
    getConvertedPosition = => return app.scaleInfo.voxelToNm(@model.flycam.getPosition())
    from = {
      notify: notify
      getConvertedPosition: getConvertedPosition
      upX: camera.up.x, upY: camera.up.y, upZ: camera.up.z
      camera: camera
      flycam: @flycam
      dx:camera.position.x - pos[0]
      dy:camera.position.y - pos[1]
      dz:camera.position.z - pos[2]
      l: camera.left, r: camera.right, t: camera.top, b: camera.bottom }
    @tween = new TWEEN.Tween(from)

    if id == constants.TDView
      diagonal = Math.sqrt(b[0]*b[0]+b[1]*b[1])
      padding = 0.05 * diagonal

      # Calculate the distance from (0, b[1]) in order to center the view
      a1 = b[0]; b1 = -b[1]; x1 = 0; y1 = b[1]
      x2 = pos[0]; y2 = pos[1]

      b2 = 1 / Math.sqrt(b1 * b1 / a1 / a1 + 1)
      a2 = - b2 * b1 / a1
      d2 = (a1 / b1 * (y1 - y2) - x1 + x2) / (- a2 + a1 * b2 / b1)

      intersect = [x2 + d2 * a2, y2 + d2 * b2]
      distance  = Dimensions.distance([x1, y1], intersect)

      # Approximation to center the view vertically
      yOffset = pos[2] - b[2] / 2

      # Calulate the x coordinate so that the vector from the camera to the cube's middle point is
      # perpendicular to the vector going from (0, b[1], 0) to (b[0], 0, 0).
      to = {
        dx: b[1] / diagonal
        dy: b[0] / diagonal
        dz:- 1 / 2
        upX: 0, upY: 0, upZ: -1
        l: -distance - padding
        r: diagonal - distance + padding
        t: diagonal / 2 + padding + yOffset
        b: -diagonal / 2 - padding + yOffset }
    else
      ind = Dimensions.getIndices(id)
      width = Math.max(b[ind[0]], b[ind[1]] * 1.12) * 1.1
      paddingTop = width * 0.12
      padding = width / 1.1 * 0.1 / 2
      offsetX = pos[ind[0]] + padding + (width - b[ind[0]]) / 2
      offsetY = pos[ind[1]] + paddingTop + padding

      positionOffset = [[0, 0, -1], [1, 0, 0], [0, 1, 0]]
      upVector       = [[0, -1, 0], [0, -1, 0], [0, 0, -1]]

      to.dx = positionOffset[id][0]
      to.dy = positionOffset[id][1]
      to.dz = positionOffset[id][2]
      to.upX = upVector[id][0]; to.upY = upVector[id][1]; to.upZ = upVector[id][2]
      to.l = -offsetX; to.t = offsetY
      to.r = to.l + width; to.b = to.t - width

    if animate
      @tween.to(to, time)
      .onUpdate(@updateCameraTDView)
      .start()
    else
      for prop of from
        unless to[prop]?
          to[prop] = from[prop]
      @updateCameraTDView.call(to)

  degToRad : (deg) -> deg/180*Math.PI

  changeTDViewXY : => @changeTDView(constants.PLANE_XY)
  changeTDViewYZ : => @changeTDView(constants.PLANE_YZ)
  changeTDViewXZ : => @changeTDView(constants.PLANE_XZ)
  changeTDViewDiagonal : (animate = true) => @changeTDView(constants.TDView, animate)

  updateCameraTDView : ->

    p = @getConvertedPosition()
    @camera.position.set(@dx + p[0], @dy + p[1], @dz + p[2])
    @camera.left = @l
    @camera.right = @r
    @camera.top = @t
    @camera.bottom = @b
    @camera.up = new THREE.Vector3(@upX, @upY, @upZ)

    @flycam.setRayThreshold(@camera.right, @camera.left)
    @camera.updateProjectionMatrix()
    @notify()
    app.vent.trigger("rerender")


  TDViewportSize : ->

    (@cameras[constants.TDView].right - @cameras[constants.TDView].left)         # always quadratic


  zoomTDView : (value, position, curWidth) =>

    camera = @cameras[constants.TDView]
    factor = Math.pow(0.9, value)
    middleX = (camera.left + camera.right)/2
    middleY = (camera.bottom + camera.top)/2
    size = @TDViewportSize()

    baseOffset = factor * size / 2
    baseDiff = baseOffset - size / 2

    if position?
      offsetX = (position.x / curWidth * 2 - 1) * (-baseDiff)
      offsetY = (position.y / curWidth * 2 - 1) * (+baseDiff)
    else
      offsetX = offsetY = 0

    camera.left = middleX - baseOffset + offsetX
    camera.right = middleX + baseOffset + offsetX
    camera.top = middleY + baseOffset + offsetY
    camera.bottom = middleY - baseOffset + offsetY
    camera.updateProjectionMatrix()

    @flycam.setRayThreshold(camera.right, camera.left)
    app.vent.trigger("rerender")


  moveTDViewX : (x) =>

    @moveTDViewRaw(
      new THREE.Vector2( x * @TDViewportSize() / constants.VIEWPORT_WIDTH, 0 ))


  moveTDViewY : (y) =>

    @moveTDViewRaw(
      new THREE.Vector2( 0, - y * @TDViewportSize() / constants.VIEWPORT_WIDTH ))


  moveTDView : ( nmVector ) ->
    # moves camera by the nm vector
    camera = @cameras[constants.TDView]

    rotation = THREE.Vector3.prototype.multiplyScalar.call(
      camera.rotation.clone(), -1
    )
    # reverse euler order
    rotation.order = rotation.order.split("").reverse().join("")

    nmVector.applyEuler( rotation )
    @moveTDViewRaw( nmVector )


  moveTDViewRaw : (moveVector) ->

    camera = @cameras[constants.TDView]
    camera.left   += moveVector.x
    camera.right  += moveVector.x
    camera.top    += moveVector.y
    camera.bottom += moveVector.y
    camera.updateProjectionMatrix()
    app.vent.trigger("rerender")


  centerTDView : ->

    camera = @cameras[constants.TDView]
    @moveTDViewRaw(
      new THREE.Vector2(
        -(camera.left + camera.right) / 2,
        -(camera.top + camera.bottom) / 2)
    )


  setClippingDistance : (value) ->

    @camDistance = value # Plane is shifted so it's <value> to the back and the front
    @updateCamViewport()


  getClippingDistance : (planeID) ->

    @camDistance * app.scaleInfo.voxelPerNM[planeID]


  updateCamViewport : ->

    scaleFactor = app.scaleInfo.baseVoxel
    boundary    = constants.VIEWPORT_WIDTH / 2 * @model.user.get("zoom")
    for i in [constants.PLANE_XY, constants.PLANE_YZ, constants.PLANE_XZ]
      @cameras[i].near = -@camDistance
      @cameras[i].left  = @cameras[i].bottom = -boundary * scaleFactor
      @cameras[i].right = @cameras[i].top    =  boundary * scaleFactor
      @cameras[i].updateProjectionMatrix()
    app.vent.trigger("rerender")


  bindToEvents : ->

    @listenTo(@model.user, "change:clippingDistance", (model, value) -> @setClippingDistance(value))
    @listenTo(@model.user, "change:zoom", (model, value) -> @updateCamViewport())


module.exports = CameraController
