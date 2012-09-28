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

    @skeleton = new Skeleton(10000, @flycam)

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
    if id in [PLANE_XY, PLANE_YZ, PLANE_XZ]
      @cube.visible = false
      for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
        if i == id
          @planes[i].setOriginalCrosshairColor()
          @planes[i].setVisible(true)
        else
          @planes[i].setVisible(false)
    else
      @cube.visible = true
      for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
        @planes[i].setGrayCrosshairColor()
        @planes[i].setVisible(true)
        @planes[i].plane.visible = @displayPlane[i]

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

  setWaypoint : (position, typeNumber) =>
    @skeleton.setWaypoint(position, typeNumber)

  onPreviewClick : (position, scaleFactor, camera) =>
    @skeleton.onPreviewClick(position, scaleFactor, camera)

  setActiveNodePosition : (position) =>
    @skeleton.setActiveNodePosition(position)

  setDisplayCrosshair : (value) =>
    for plane in @planes
      plane.setDisplayCrosshair value
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
    console.log "result: " + result
    return result