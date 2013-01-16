### define
../model : Model
../view : View
../geometries/plane : Plane
../geometries/skeleton : Skeleton
../model/dimensions : DimensionsHelper
###


PLANE_XY         = Dimensions.PLANE_XY
PLANE_YZ         = Dimensions.PLANE_YZ
PLANE_XZ         = Dimensions.PLANE_XZ
VIEW_3D          = Dimensions.VIEW_3D
WIDTH            = 384
VIEWPORT_WIDTH   = 380
TEXTURE_WIDTH    = 512

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

    @createMeshes()

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

    @skeleton = new Skeleton(1000000, @flycam, @model)

    # create Meshes
    @planes = new Array(3)
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
      @planes[i] = new Plane(VIEWPORT_WIDTH, TEXTURE_WIDTH, @flycam, i, @model)

    @planes[PLANE_XY].setRotation(new THREE.Vector3( Math.PI , 0, 0))
    @planes[PLANE_YZ].setRotation(new THREE.Vector3( Math.PI, 1/2 * Math.PI, 0))
    @planes[PLANE_XZ].setRotation(new THREE.Vector3( - 1/2 * Math.PI, 0, 0))

  vec : (x, y, z) ->
    new THREE.Vector3(x, y, z)

  updateSceneForCam : (id) =>
    # This method is called for each of the four cams. Even
    # though they are all looking at the same scene, some
    # things have to be changed for each cam.
    if id in [PLANE_XY, PLANE_YZ, PLANE_XZ]
      @cube.visible = false
      for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
        if i == id
          @planes[i].setOriginalCrosshairColor()
          @planes[i].setVisible(true)
          pos = @flycam.getGlobalPos().slice()
          ind = Dimensions.getIndices(i)
          # Offset the plane so the user can see the route behind the plane
          pos[ind[2]] += if i==PLANE_XY then @planeShift[ind[2]] else -@planeShift[ind[2]]
          @planes[i].setPosition(new THREE.Vector3(pos...))
        else
          @planes[i].setVisible(false)
    else
      @cube.visible = true
      for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
        pos = @flycam.getGlobalPos()
        @planes[i].setPosition(new THREE.Vector3(pos[0], pos[1], pos[2]))
        @planes[i].setGrayCrosshairColor()
        @planes[i].setVisible(true)
        @planes[i].plane.visible = @displayPlane[i]

  update : =>
    gPos         = @flycam.getGlobalPos()
    globalPosVec = new THREE.Vector3(gPos...)
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
      
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
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
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
    # Return whether this was the first toggle
    res = false
    unless @showSkeleton?
      res = true
      @showSkeleton = true
    @showSkeleton = not @showSkeleton
    @skeleton.setVisibility(@showSkeleton)
    return res
