app             = require("app")
Backbone        = require("backbone")
Plane           = require("../geometries/plane")
Skeleton        = require("../geometries/skeleton")
Cube            = require("../geometries/cube")
ContourGeometry = require("../geometries/contourgeometry")
VolumeGeometry  = require("../geometries/volumegeometry")
Dimensions      = require("../model/dimensions")
constants       = require("../constants")
PolygonFactory  = require("../view/polygons/polygon_factory")
THREE           = require("three")

class SceneController

  # This class collects all the meshes displayed in the Skeleton View and updates position and scale of each
  # element depending on the provided flycam.

  CUBE_COLOR : 0x999999

  constructor : (@upperBoundary, @flycam, @model) ->

    _.extend(this, Backbone.Events)

    @current          = 0
    @displayPlane     = [true, true, true]
    @planeShift       = [0, 0, 0]
    @pingBinary       = true
    @pingBinarySeg    = true

    @volumeMeshes   = []

    @createMeshes()
    @bindToEvents()


  createMeshes : ->
    # Cubes
    @cube = new Cube(@model, {
      max : @upperBoundary
      color : @CUBE_COLOR
      showCrossSections : true })
    @userBoundingBox = new Cube(@model, {
      max : [0, 0, 0]
      color : 0xffaa00
      showCrossSections : true })

    if @model.taskBoundingBox?
      @taskBoundingBox = new Cube(@model, {
        min : @model.taskBoundingBox.min
        max : @model.taskBoundingBox.max
        color : 0x00ff00
        showCrossSections : true })

    # TODO: Implement text

    if @model.volumeTracing?
      @contour = new ContourGeometry(@model.volumeTracing, @model.flycam)

    if @model.skeletonTracing?
      @skeleton = new Skeleton(@model)

    # create Meshes
    @planes = new Array(3)
    for i in [constants.PLANE_XY, constants.PLANE_YZ, constants.PLANE_XZ]
      @planes[i] = new Plane(constants.PLANE_WIDTH, constants.TEXTURE_WIDTH, @flycam, i, @model)

    @planes[constants.PLANE_XY].setRotation(new THREE.Euler( Math.PI , 0, 0))
    @planes[constants.PLANE_YZ].setRotation(new THREE.Euler( Math.PI, 1/2 * Math.PI, 0))
    @planes[constants.PLANE_XZ].setRotation(new THREE.Euler( - 1/2 * Math.PI, 0, 0))


  removeShapes : ->

    @trigger("removeGeometries", @volumeMeshes)


  showShapes : (bb, resolution, id) ->

    return unless @model.getSegmentationBinary()?

    if @polygonFactory?
      @polygonFactory.cancel()

    @polygonFactory = new PolygonFactory(
      @model.getSegmentationBinary().cube
      resolution
      bb.min, bb.max, id
    )

    @polygonFactory.getTriangles().then (triangles) =>

      @removeShapes()
      @volumeMeshes = []

      for id of triangles
        mappedId = @model.getSegmentationBinary().cube.mapId(parseInt(id))
        volume = new VolumeGeometry(triangles[id], mappedId)
        @volumeMeshes = @volumeMeshes.concat(volume.getMeshes())

      @trigger("newGeometries", @volumeMeshes)
      app.vent.trigger("rerender")
      @polygonFactory = null


  updateSceneForCam : (id) =>

    # This method is called for each of the four cams. Even
    # though they are all looking at the same scene, some
    # things have to be changed for each cam.

    @cube.updateForCam(id)
    @userBoundingBox.updateForCam(id)
    @taskBoundingBox?.updateForCam(id)
    @skeleton?.updateForCam(id)

    if id in constants.ALL_PLANES
      for mesh in @volumeMeshes
        mesh.visible = false
      for i in constants.ALL_PLANES
        if i == id
          @planes[i].setOriginalCrosshairColor()
          @planes[i].setVisible(true)
          pos = @flycam.getPosition().slice()
          ind = Dimensions.getIndices(i)
          # Offset the plane so the user can see the skeletonTracing behind the plane
          pos[ind[2]] += if i==constants.PLANE_XY then @planeShift[ind[2]] else -@planeShift[ind[2]]
          @planes[i].setPosition(new THREE.Vector3(pos...))
        else
          @planes[i].setVisible(false)
    else
      for mesh in @volumeMeshes
        mesh.visible = true
      for i in constants.ALL_PLANES
        pos = @flycam.getPosition()
        @planes[i].setPosition(new THREE.Vector3(pos[0], pos[1], pos[2]))
        @planes[i].setGrayCrosshairColor()
        @planes[i].setVisible(true)
        @planes[i].plane.visible = @displayPlane[i]


  update : =>

    gPos         = @flycam.getPosition()
    globalPosVec = new THREE.Vector3(gPos...)
    planeScale   = @flycam.getPlaneScalingFactor()
    for i in constants.ALL_PLANES

      @planes[i].updateTexture()

      # Update plane position
      @planes[i].setPosition(globalPosVec)

      # Update plane scale
      @planes[i].setScale(planeScale)


  setTextRotation : (rotVec) ->

    # TODO: Implement


  setDisplayCrosshair : (value) ->

    for plane in @planes
      plane.setDisplayCrosshair value
    app.vent.trigger("rerender")


  setClippingDistance : (value) ->

    # convert nm to voxel
    for i in constants.ALL_PLANES
      @planeShift[i] = value * app.scaleInfo.voxelPerNM[i]
    app.vent.trigger("rerender")


  setInterpolation : (value) ->

    for plane in @planes
      plane.setLinearInterpolationEnabled(value)
    app.vent.trigger("rerender")


  setDisplayPlanes : (value) =>

    for i in [0..2]
      @displayPlane[i] = value
    app.vent.trigger("rerender")


  getMeshes : =>

    result = []
    for plane in @planes
      result = result.concat(plane.getMeshes())

    for geometry in [@skeleton, @contour, @cube, @userBoundingBox, @taskBoundingBox]
      if geometry?
        result = result.concat geometry.getMeshes()

    return result


  setUserBoundingBox : (bb) ->

    @userBoundingBox.setCorners(bb.min, bb.max)


  setSegmentationAlpha : (alpha) ->

    for plane in @planes
      plane.setSegmentationAlpha(alpha)
    @pingBinarySeg = alpha != 0

  pingDataLayer : (dataLayerName) ->

    if @model.binary[dataLayerName].category == "color"
      return @pingBinary
    if @model.binary[dataLayerName].category == "segmentation"
      return @pingBinarySeg
    return false


  stop : ->

    for plane in @planes
      plane.setVisible(false)
    @cube.setVisibility(false)
    @userBoundingBox.setVisibility(false)
    @taskBoundingBox?.setVisibility(false)

    @skeleton?.restoreVisibility()
    @skeleton?.setSizeAttenuation(true)


  start : ->

    for plane in @planes
      plane.setVisible(true)
    @cube.setVisibility(true)
    @userBoundingBox.setVisibility(true)
    @taskBoundingBox?.setVisibility(true)

    @skeleton?.setSizeAttenuation(false)


  bindToEvents : ->

    user = @model.user
    @listenTo(@model, "change:userBoundingBox", (bb) -> @setUserBoundingBox(bb))
    @listenTo(user, "change:segmentationOpacity", (model, opacity) ->
      @setSegmentationAlpha(opacity)
    )
    @listenTo(user, "change:clippingDistance", (model, value) -> @setClippingDistance(value))
    @listenTo(user, "change:displayCrosshair", (model, value) -> @setDisplayCrosshair(value))
    @listenTo(@model.datasetConfiguration, "change:interpolation", (model, value) ->
      @setInterpolation(value)
    )
    @listenTo(user, "change:tdViewDisplayPlanes", (model, value) -> @setDisplayPlanes(value))

module.exports = SceneController
