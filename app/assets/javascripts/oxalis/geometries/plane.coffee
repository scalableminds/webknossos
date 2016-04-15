app                  = require("app")
Model                = require("../model")
View                 = require("../view")
Dimensions           = require("../model/dimensions")
constants            = require("../constants")
THREE                = require("three")
PlaneMaterialFactory = require("./materials/plane_material_factory")

class Plane

  # This class is supposed to collect all the Geometries that belong to one single plane such as
  # the plane itself, its texture, borders and crosshairs.

  CROSSHAIR_COLORS : [[0x0000ff, 0x00ff00], [0xff0000, 0x00ff00], [0x0000ff, 0xff0000]]
  GRAY_CH_COLOR    : 0x222222


  constructor : (planeWidth, textureWidth, flycam, planeID, model) ->

    @flycam          = flycam
    @planeID         = planeID
    @model           = model
    @planeWidth      = planeWidth
    @textureWidth    = textureWidth
    @displayCosshair = true

    # planeWidth means that the plane should be that many voxels wide in the
    # dimension with the highest resolution. In all other dimensions, the plane
    # is smaller in voxels, so that it is squared in nm.
    # --> app.scaleInfo.baseVoxel
    scaleArray = Dimensions.transDim(app.scaleInfo.baseVoxelFactors, @planeID)
    @scaleVector = new THREE.Vector3(scaleArray...)

    @createMeshes(planeWidth, textureWidth)

  createMeshes : (pWidth, tWidth) ->

    # create plane
    planeGeo = new THREE.PlaneGeometry(pWidth, pWidth, 1, 1)
    textureMaterial = new PlaneMaterialFactory(@model, tWidth).getMaterial()
    @plane = new THREE.Mesh( planeGeo, textureMaterial )

    # create crosshair
    crosshairGeometries = new Array(2)
    @crosshair          = new Array(2)
    for i in [0..1]
      crosshairGeometries[i] = new THREE.Geometry()
      crosshairGeometries[i].vertices.push(new THREE.Vector3(-pWidth/2*i, -pWidth/2*(1-i), 0))
      crosshairGeometries[i].vertices.push(new THREE.Vector3( -25*i,  -25*(1-i), 0))
      crosshairGeometries[i].vertices.push(new THREE.Vector3( 25*i, 25*(1-i), 0))
      crosshairGeometries[i].vertices.push(new THREE.Vector3( pWidth/2*i,  pWidth/2*(1-i), 0))
      @crosshair[i] = new THREE.Line(crosshairGeometries[i], new THREE.LineBasicMaterial({color: @CROSSHAIR_COLORS[@planeID][i], linewidth: 1}), THREE.LinePieces)

    # create borders
    TDViewBordersGeo = new THREE.Geometry()
    TDViewBordersGeo.vertices.push(new THREE.Vector3( -pWidth/2, -pWidth/2, 0))
    TDViewBordersGeo.vertices.push(new THREE.Vector3( -pWidth/2,  pWidth/2, 0))
    TDViewBordersGeo.vertices.push(new THREE.Vector3(  pWidth/2,  pWidth/2, 0))
    TDViewBordersGeo.vertices.push(new THREE.Vector3(  pWidth/2, -pWidth/2, 0))
    TDViewBordersGeo.vertices.push(new THREE.Vector3( -pWidth/2, -pWidth/2, 0))
    @TDViewBorders = new THREE.Line(TDViewBordersGeo, new THREE.LineBasicMaterial({color: constants.PLANE_COLORS[@planeID], linewidth: 1}))


  setDisplayCrosshair : (value) =>

    @displayCosshair = value


  setOriginalCrosshairColor : =>

    for i in [0..1]
      @crosshair[i].material = new THREE.LineBasicMaterial({color: @CROSSHAIR_COLORS[@planeID][i], linewidth: 1})


  setGrayCrosshairColor : =>

    for i in [0..1]
      @crosshair[i].material = new THREE.LineBasicMaterial({color: @GRAY_CH_COLOR, linewidth: 1})


  updateTexture : =>

      globalPos = @flycam.getPosition()

      area = @flycam.getArea(@planeID)
      tPos = @flycam.getTexturePosition(@planeID).slice()
      if @model?
        for name, binary of @model.binary

          dataBuffer = binary.planes[@planeID].get(
            position : @flycam.getTexturePosition(@planeID)
            zoomStep : @flycam.getIntegerZoomStep()
            area : @flycam.getArea(@planeID)
          )

          if dataBuffer
            @plane.material.setData name, dataBuffer
            app.vent.trigger("rerender")

      @plane.material.setScaleParams(
        repeat :
          x : (area[2] -  area[0]) / @textureWidth
          y : (area[3] -  area[1]) / @textureWidth
        offset :
          x : area[0] / @textureWidth
          y : 1 - area[3] / @textureWidth
      )


  setScale : (factor) =>

    scaleVec = new THREE.Vector3().multiplyVectors(new THREE.Vector3(factor, factor, factor), @scaleVector)
    @plane.scale = @TDViewBorders.scale = @crosshair[0].scale = @crosshair[1].scale = scaleVec


  setRotation : (rotVec) =>

    for mesh in [ @plane, @TDViewBorders, @crosshair[0], @crosshair[1] ]
      mesh.setRotationFromEuler rotVec


  setPosition : (posVec) =>

    @TDViewBorders.position = @crosshair[0].position = @crosshair[1].position = posVec

    offset = new THREE.Vector3(0, 0, 0)
    if      @planeID == constants.PLANE_XY then offset.z =  1
    else if @planeID == constants.PLANE_YZ then offset.x = -1
    else if @planeID == constants.PLANE_XZ then offset.y = -1
    @plane.position = offset.addVectors(posVec, offset)


  setVisible : (visible) =>

    @plane.visible = @TDViewBorders.visible = visible
    @crosshair[0].visible = @crosshair[1].visible = visible and @displayCosshair


  setSegmentationAlpha : (alpha) ->
    @plane.material.setSegmentationAlpha alpha
    app.vent.trigger("rerender")


  getMeshes : =>

    [@plane, @TDViewBorders, @crosshair[0], @crosshair[1]]


  setLinearInterpolationEnabled : (enabled) =>

    @plane.material.setColorInterpolation(
      if enabled then THREE.LinearFilter else THREE.NearestFilter
    )

module.exports = Plane
