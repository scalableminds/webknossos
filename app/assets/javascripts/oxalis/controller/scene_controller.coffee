### define
../geometries/plane : Plane
../geometries/skeleton : Skeleton
../model/dimensions : Dimensions
../constants : constants
###

class SceneController

  # This class collects all the meshes displayed in the Sceleton View and updates position and scale of each
  # element depending on the provided flycam.

  constructor : (upperBoundary, flycam, model) ->
    @upperBoundary = upperBoundary
    @flycam        = flycam
    @model         = model
    @current       = 0
    @displayPlane  = [true, true, true]
    @planeShift    = [0, 0, 0]
    @showSkeleton  = true

    @createMeshes()
    @bind()

  createMeshes : ->
    # Cube
    b   = @upperBoundary
    geo = new THREE.Geometry()
    v   = geo.vertices
    v.push(@vec(   0,    0,    0));      v.push(@vec(   0, b[1],    0))
    v.push(@vec(b[0], b[1],    0));      v.push(@vec(b[0],    0,    0))
    v.push(@vec(b[0],    0, b[2]));      v.push(@vec(b[0], b[1], b[2]))
    v.push(@vec(   0, b[1], b[2]));      v.push(@vec(   0,    0, b[2]))
    v.push(@vec(   0,    0,    0));      v.push(@vec(b[0],    0,    0))
    v.push(@vec(b[0], b[1],    0));      v.push(@vec(b[0], b[1], b[2]))
    v.push(@vec(b[0],    0, b[2]));      v.push(@vec(   0,    0, b[2]))
    v.push(@vec(   0, b[1], b[2]));      v.push(@vec(   0, b[1],    0))
    @cube = new THREE.Line(geo, new THREE.LineBasicMaterial({color: 0x999999, linewidth: 1}))

    # TODO: Implement text 

    @skeleton = new Skeleton(@flycam, @model)

    # create Meshes
    @planes = new Array(3)
    for i in [constants.PLANE_XY, constants.PLANE_YZ, constants.PLANE_XZ]
      @planes[i] = new Plane(constants.VIEWPORT_WIDTH, constants.TEXTURE_WIDTH, @flycam, i, @model)

    @planes[constants.PLANE_XY].setRotation(new THREE.Vector3( Math.PI , 0, 0))
    @planes[constants.PLANE_YZ].setRotation(new THREE.Vector3( Math.PI, 1/2 * Math.PI, 0))
    @planes[constants.PLANE_XZ].setRotation(new THREE.Vector3( - 1/2 * Math.PI, 0, 0))

  vec : (x, y, z) ->
    new THREE.Vector3(x, y, z)

  updateSceneForCam : (id) =>
    # This method is called for each of the four cams. Even
    # though they are all looking at the same scene, some
    # things have to be changed for each cam.
    if id in constants.ALL_PLANES
      @cube.visible = false
      unless @showSkeleton
        @skeleton.setVisibility(false)
      for i in constants.ALL_PLANES
        if i == id
          @planes[i].setOriginalCrosshairColor()
          @planes[i].setVisible(true)
          pos = @flycam.getPosition().slice()
          ind = Dimensions.getIndices(i)
          # Offset the plane so the user can see the route behind the plane
          pos[ind[2]] += if i==constants.PLANE_XY then @planeShift[ind[2]] else -@planeShift[ind[2]]
          @planes[i].setPosition(new THREE.Vector3(pos...))
        else
          @planes[i].setVisible(false)
    else
      @cube.visible = true
      unless @showSkeleton
        @skeleton.setVisibility(true)
      for i in constants.ALL_PLANES
        pos = @flycam.getPosition()
        @planes[i].setPosition(new THREE.Vector3(pos[0], pos[1], pos[2]))
        @planes[i].setGrayCrosshairColor()
        @planes[i].setVisible(true)
        @planes[i].plane.visible = @displayPlane[i]

  update : =>
    gPos         = @flycam.getPosition()
    globalPosVec = new THREE.Vector3(gPos...)
    for i in constants.ALL_PLANES
      
      @planes[i].updateTexture()

      # Update plane position
      @planes[i].setPosition(globalPosVec)

      # Update plane scale
      sFactor      = @flycam.getPlaneScalingFactor(i)
      @planes[i].setScale(sFactor)

  setTextRotation : (rotVec) =>
    # TODO: Implement

  setWaypoint : =>
    @skeleton.setWaypoint()

  setDisplayCrosshair : (value) =>
    for plane in @planes
      plane.setDisplayCrosshair value
    @flycam.hasChanged = true

  setRouteClippingDistance : (value) =>
    # convert nm to voxel
    for i in constants.ALL_PLANES
      @planeShift[i] = 2 * value * @model.scaleInfo.voxelPerNM[i]

  setInterpolation : (value) =>
    for plane in @planes
      plane.setLinearInterpolationEnabled(value)
    @flycam.hasChanged = true

  setDisplaySV : (plane, value) =>
    @displayPlane[plane] = value
    @flycam.hasChanged = true

  getMeshes : =>
    result = []
    for plane in @planes
      result = result.concat(plane.getMeshes())
    result = result.concat(@skeleton.getMeshes())
    result.push(@cube)
    return result

  toggleSkeletonVisibility : ->
    @showSkeleton = not @showSkeleton
    @skeleton.setVisibility(@showSkeleton)

  bind : ->

    @model.user.on "routeClippingDistanceChanged", (value) =>
      @setRouteClippingDistance(value)

    @model.user.on "displayCrosshairChanged", (value) =>
      @setDisplayCrosshair(value)
    
    @model.user.on "interpolationChanged", (value) =>
      @setInterpolation(value)

    @model.user.on "displayPreviewXYChanged", (value) =>
      @setDisplaySV constants.PLANE_XY, value

    @model.user.on "displayPreviewYZChanged", (value) =>
      @setDisplaySV constants.PLANE_YZ, value

    @model.user.on "displayPreviewXZChanged", (value) =>
      @setDisplaySV constants.PLANE_XZ, value      
