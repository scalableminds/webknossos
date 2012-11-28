### define
model : Model
view : View
geometries/plane : Plane
geometries/skeleton : Skeleton
###


PLANE_XY         = 0
PLANE_YZ         = 1
PLANE_XZ         = 2
VIEW_3D          = 3
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

    @skeleton = new Skeleton(10000, @flycam, @model.route)

    # create Meshes
    @planes = new Array(3)
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
      @planes[i] = new Plane(VIEWPORT_WIDTH, TEXTURE_WIDTH, @flycam, i, @model)

    @planes[PLANE_XY].setRotation(new THREE.Vector3(-90 /180*Math.PI, 0, 0))
    @planes[PLANE_YZ].setRotation(new THREE.Vector3(-90 /180*Math.PI, 0, -90 /180*Math.PI))
    @planes[PLANE_XZ].setRotation(new THREE.Vector3(0, 0, 0))

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
          ind = @flycam.getIndices(i)
          # Offset the plane so the user can see the route behind the plane
          pos[ind[2]] += if i==PLANE_XY then @planeShift[ind[2]] else -@planeShift[ind[2]]
          @planes[i].setPosition(new THREE.Vector3(pos...))
        else
          @planes[i].setVisible(false)
      # Distort the spheres so that in the plane's z-direction they have a radius as
      # big as the routeClippingDistance (alias planeShift)
      #for sphere in @skeleton.nodesSpheres.concat(@skeleton.activeNode)
      #  scale = Math.max(sphere.scale.x, sphere.scale.y, sphere.scale.z)
      #  scaleArray = [scale, scale, scale]
      #  scaleArray[@flycam.getIndices(id)[2]] = Math.min(@planeShift / sphere.boundRadius,
      #                                              scaleArray[@flycam.getIndices(id)[2]])
      #  sphere.scale.set(scaleArray[0], scaleArray[1], scaleArray[2])
    else
      @cube.visible = true
      for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
        pos = @flycam.getGlobalPos()
        @planes[i].setPosition(new THREE.Vector3(pos[0], pos[1], pos[2]))
        @planes[i].setGrayCrosshairColor()
        @planes[i].setVisible(true)
        @planes[i].plane.visible = @displayPlane[i]
      #for sphere in @skeleton.nodesSpheres.concat(@skeleton.activeNode)
      #  scale = Math.max(sphere.scale.x, sphere.scale.y, sphere.scale.z)
      #  sphere.scale.set(scale, scale, scale)

  update : =>
    gPos         = @flycam.getGlobalPos()
    globalPosVec = new THREE.Vector3(gPos[0], gPos[1], gPos[2])
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
      @planeShift[i] = 2 * value * @model.route.voxelPerNM[i]

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

  # Will completely reload the trees from model.
  # This needs to be done at initialization or whenever
  # the skeleton is changes in a way that can't efficiently
  # applied to the particle system, like deleting nodes.
  updateRoute : ->
    @skeleton.reset()
    @flycam.hasChanged = true