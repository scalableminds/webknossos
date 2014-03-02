### define
../geometries/plane : Plane
../geometries/skeleton : Skeleton
../geometries/cube : Cube
../geometries/contourgeometry : ContourGeometry
../geometries/volumegeometry : VolumeGeometry
../model/dimensions : Dimensions
../../libs/event_mixin : EventMixin
../constants : constants
../view/polygons/polygon_factory : PolygonFactory
three : THREE
###

class SceneController

  # This class collects all the meshes displayed in the Sceleton View and updates position and scale of each
  # element depending on the provided flycam.

  CUBE_COLOR : 0x999999

  constructor : (@upperBoundary, @flycam, @model) ->

    _.extend(@, new EventMixin())

    @current          = 0
    @displayPlane     = [true, true, true]
    @planeShift       = [0, 0, 0]
    @pingBinary       = true
    @pingBinarySeg    = true

    @polygonFactory = new PolygonFactory( @model.binary["segmentation"]?.cube )
    @volumeMeshes   = []

    @createMeshes()
    @bind()


  createMeshes : ->
    # Cubes
    @cube = new Cube(@model, {
      max : @upperBoundary
      color : @CUBE_COLOR
      showCrossSections : true })
    @bb = new Cube(@model, {
      max : [0, 0, 0]
      color : 0xffaa00
      showCrossSections : true })

    if @model.boundingBox?
      @bb2 = new Cube(@model, {
        min : @model.boundingBox.min
        max : _.map @model.boundingBox.max, (e) -> e + 1
        color : 0x00ff00
        showCrossSections : true })

    # TODO: Implement text 

    if @model.volumeTracing?
      @contour = new ContourGeometry(@model.volumeTracing, @model.flycam)

    if @model.skeletonTracing?
      @skeleton = new Skeleton(@flycam, @model)

    # create Meshes
    @planes = new Array(3)
    for i in [constants.PLANE_XY, constants.PLANE_YZ, constants.PLANE_XZ]
      @planes[i] = new Plane(constants.PLANE_WIDTH, constants.TEXTURE_WIDTH, @flycam, i, @model)

    @planes[constants.PLANE_XY].setRotation(new THREE.Euler( Math.PI , 0, 0))
    @planes[constants.PLANE_YZ].setRotation(new THREE.Euler( Math.PI, 1/2 * Math.PI, 0))
    @planes[constants.PLANE_XZ].setRotation(new THREE.Euler( - 1/2 * Math.PI, 0, 0))


  showShapes : (min, max, id) ->

    @trigger("removeGeometries", @volumeMeshes)
    @volumeMeshes = []

    start1 = (new Date()).getTime()
    triangles = @polygonFactory.getTriangles(min, max, id)
    console.log "[3D Cells] Time to calculate Triangles", (start2 = (new Date()).getTime()) - start1

    for id of triangles
      volume = new VolumeGeometry( triangles[id], parseInt( id ) )
      @volumeMeshes = @volumeMeshes.concat( volume.getMeshes() )
    @trigger("newGeometries", @volumeMeshes)
    console.log "[3D Cells] Time to add and create Geometries", (new Date()).getTime() - start2
    console.log "[3D Cells] Total time", (new Date()).getTime() - start1

    @flycam.update()


  updateSceneForCam : (id) =>

    # This method is called for each of the four cams. Even
    # though they are all looking at the same scene, some
    # things have to be changed for each cam.

    @cube.updateForCam(id)
    @bb.updateForCam(id)
    @bb2?.updateForCam(id)
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


  setTextRotation : (rotVec) =>

    # TODO: Implement


  setDisplayCrosshair : (value) =>

    for plane in @planes
      plane.setDisplayCrosshair value
    @flycam.update()


  setClippingDistance : (value) =>

    # convert nm to voxel
    for i in constants.ALL_PLANES
      @planeShift[i] = value * @model.scaleInfo.voxelPerNM[i]


  setInterpolation : (value) =>

    for plane in @planes
      plane.setLinearInterpolationEnabled(value)
    @flycam.update()


  setDisplaySV : (plane, value) =>

    @displayPlane[plane] = value
    @flycam.update()


  getMeshes : =>

    result = []
    for plane in @planes
      result = result.concat(plane.getMeshes())

    for geometry in [@skeleton, @contour, @cube, @bb, @bb2]
      if geometry?
        result = result.concat geometry.getMeshes()
    
    return result


  setBoundingBox : (bbArray) ->

    @bb.setCorners([bbArray[0], bbArray[1], bbArray[2]],
                    [bbArray[3], bbArray[4], bbArray[5]])


  setSegmentationAlpha : (alpha) ->

    for plane in @planes
      plane.setSegmentationAlpha( alpha )
    @pingBinarySeg = alpha != 0
    #console.log "pingValues:", @pingBinary, @pingBinarySeg

  pingDataLayer : (dataLayerName) ->

    if dataLayerName == "color" then return @pingBinary
    if dataLayerName == "segmentation" then return @pingBinarySeg
    false


  stop : ->

    for plane in @planes
      plane.setVisible(false)
    @cube.setVisibility( false )
    @bb.setVisibility( false )
    @bb2?.setVisibility( false )

    @skeleton?.restoreVisibility()
    @skeleton?.setSizeAttenuation(true)


  start : ->

    for plane in @planes
      plane.setVisible(true)
    @cube.setVisibility( true )
    @bb.setVisibility( true )
    @bb2?.setVisibility( true )

    @skeleton?.setSizeAttenuation(false)


  bind : ->
    
    @model.user.on({
      clippingDistanceChanged : (value) =>
        @setClippingDistance(value)
      displayCrosshairChanged : (value) =>
        @setDisplayCrosshair(value)
      interpolationChanged : (value) =>
        @setInterpolation(value)
      displayTDViewXYChanged : (value) =>
        @setDisplaySV constants.PLANE_XY, value
      displayTDViewYZChanged : (value) =>
        @setDisplaySV constants.PLANE_YZ, value
      displayTDViewXZChanged : (value) =>
        @setDisplaySV constants.PLANE_XZ, value  })
