### define
model : Model
view : View
geometries/plane : Plane
###


PLANE_XY         = 0
PLANE_YZ         = 1
PLANE_XZ         = 2
VIEW_3D          = 3
WIDTH            = 380
TEXTURE_WIDTH    = 512

class SkeletonView

  # This class collects all the meshes displayed in the Sceleton View and updates position and scale of each
  # element depending on the provided flycam.

  constructor : (upperBoundary, flycam, model, mainPlanes) ->
    @upperBoundary = upperBoundary
    @flycam        = flycam
    @model         = model
    @mainPlanes    = mainPlanes

    @createMeshes()

  createMeshes : ->
    # Three planes
    @planes = new Array(3)
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
      @planes[i] = new Plane(WIDTH, TEXTURE_WIDTH, @flycam, i)

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

  vec : (x, y, z) ->
    new THREE.Vector3(x, y, z)

  update : =>
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]

      # Update plane texture
      @planes[i].updateTexture(@mainPlanes[i].plane.texture)

      # Update plane position
      gPos         = @flycam.getGlobalPos()
      globalPosVec = new THREE.Vector3(gPos[0], gPos[1], gPos[2])
      @planes[i].setPosition(globalPosVec)

      # Update plane scale
      sFactor      = @flycam.getPlaneScalingFactor(i)
      @planes[i].setScale(sFactor)

  setTextRotation : (rotVec) =>
    # TODO: Implement

  getMeshes : =>
    result = new Array(13)
    for i in [0..2]
      meshes = @planes[i].getMeshes()
      for j in [0..3]
        result[i*4+j] = meshes[j]

    result[12] = @cube

    return result