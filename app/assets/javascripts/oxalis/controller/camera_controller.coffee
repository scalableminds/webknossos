### define
../model : Model
../view : View
../model/dimensions : Dimensions
../constants : constants
###

class CameraController

  # The Sceleton View Camera Controller handles the orthographic camera which is looking at the Skeleton
  # View. It provides methods to set a certain View (animated).

  cameras : null
  lights : null
  flycam : null
  model : null

  constructor : (@cameras, @lights, @flycam, @model) ->

    @updateCamViewport()
    for cam in @cameras
      cam.near = -1000000
      cam.far  =  1000000

    @bind()

  update : =>
    gPos = @flycam.getPosition()
    # camera porition's unit is nm, so convert it.
    cPos = @model.scaleInfo.voxelToNm(gPos)
    @cameras[constants.PLANE_XY].position = new THREE.Vector3(cPos[0]    , cPos[1]    , cPos[2] - 1)
    @cameras[constants.PLANE_YZ].position = new THREE.Vector3(cPos[0] + 1, cPos[1]    , cPos[2])
    @cameras[constants.PLANE_XZ].position = new THREE.Vector3(cPos[0]    , cPos[1] + 1, cPos[2])

    # offset the lights very far
    @lights[constants.PLANE_XY].position = new THREE.Vector3(cPos[0]         , cPos[1]         , cPos[2] - 100000)
    @lights[constants.PLANE_YZ].position = new THREE.Vector3(cPos[0] + 100000, cPos[1]         , cPos[2])
    @lights[constants.PLANE_XZ].position = new THREE.Vector3(cPos[0]         , cPos[1] + 100000, cPos[2])

  changePrev : (id) ->
    # In order for the rotation to be correct, it is not sufficient
    # to just use THREEJS' lookAt() function, because it may still
    # look at the plane in a wrong angle. Therefore, the rotation
    # has to be hard coded.
    #
    # CORRECTION: You're telling lies, you need to use the up vector...

    camera = @cameras[constants.VIEW_3D]
    b = @model.scaleInfo.voxelToNm(@model.binary.cube.upperBoundary)
    time = 800
    @tween = new TWEEN.Tween({  middle: new THREE.Vector3(b[0]/2, b[1]/2, b[2]/2), upX: camera.up.x, upY: camera.up.y, upZ: camera.up.z, camera: camera, flycam: @flycam,sv : @skeletonView,x: camera.position.x,y: camera.position.y,z: camera.position.z,l: camera.left,r: camera.right,t: camera.top,b: camera.bottom })
    switch id
      when constants.VIEW_3D
        scale = Math.sqrt(b[0]*b[0]+b[1]*b[1])/1.8
        # Calulate the x coordinate so that the vector from the camera to the cube's middle point is
        # perpendicular to the vector going from (0, b[1], 0) to (b[0], 0, 0).
        x = b[1] * b[1] / (2 * b[0]) + b[0] / 2
        @tween.to({  x: x, y: b[1], z: b[2] * 0.1, upX: 0, upY: 0, upZ: -1, l: -scale, r: scale, t: scale-scale*0.1, b: -scale-scale*0.1}, time)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (-36.25, 30.6, 20.47) -> (-36.25, 30.6, 20.47)
      when constants.PLANE_XY
        scale = (Math.max b[0], b[1] * 1.12)/1.75
        @tween.to({  x: b[0]/2, y: b[1]/2, z: 0, upX: 0, upY: -1, upZ: 0, l: -scale, r: scale, t: scale+scale*0.12, b: -scale+scale*0.12}, time)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (-90, 0, 90) -> (-90, 0, 0)
      when constants.PLANE_YZ
        scale = (Math.max b[1] * 1.12, b[2])/1.75
        @tween.to({  x: b[0], y: b[1]/2, z: b[2]/2, upX: 0, upY: -1, upZ: 0, l: -scale, r: scale, t: scale+scale*0.12, b: -scale+scale*0.12}, time)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (0, 90, 0) -> (-90, 90, 0)
      when constants.PLANE_XZ
        scale = (Math.max b[0], b[2] * 1.12)/1.75
        @tween.to({  x: b[0]/2, y: b[1], z: b[2]/2, upX: 0, upY: 0, upZ: -1, l: -scale, r: scale, t: scale+scale*0.12, b: -scale+scale*0.12}, time)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (0, 0, 0) -> (0, 0, 0)
    @flycam.hasChanged = true

  degToRad : (deg) -> deg/180*Math.PI

  changePrevXY : => @changePrev(constants.PLANE_XY)
  changePrevYZ : => @changePrev(constants.PLANE_YZ)
  changePrevXZ : => @changePrev(constants.PLANE_XZ)
  changePrevSV : => @changePrev(constants.VIEW_3D)

  updateCameraPrev : ->
    @camera.position = new THREE.Vector3(@x, @y, @z)
    @camera.left = @l
    @camera.right = @r
    @camera.top = @t
    @camera.bottom = @b
    @camera.up = new THREE.Vector3(@upX, @upY, @upZ)
    @camera.lookAt(@middle)

    @flycam.setRayThreshold(@camera.right, @camera.left)

    @camera.updateProjectionMatrix()
    @flycam.hasChanged = true
    
  prevViewportSize : ->
    (@cameras[constants.VIEW_3D].right - @cameras[constants.VIEW_3D].left)         # always quadratic

  zoomPrev : (value) =>
    camera = @cameras[constants.VIEW_3D]
    factor = Math.pow(0.9, value)
    middleX = (camera.left + camera.right)/2
    middleY = (camera.bottom + camera.top)/2
    size = @prevViewportSize()
    camera.left = middleX - factor*size/2
    camera.right = middleX + factor*size/2
    camera.top = middleY + factor*size/2
    camera.bottom = middleY - factor*size/2
    camera.updateProjectionMatrix()

    @flycam.setRayThreshold(camera.right, camera.left)
    @flycam.hasChanged = true

  movePrevX : (x) =>
    size = @prevViewportSize()
    @cameras[constants.VIEW_3D].left += x*size/384
    @cameras[constants.VIEW_3D].right += x*size/384
    @cameras[constants.VIEW_3D].updateProjectionMatrix()
    @flycam.hasChanged = true

  movePrevY : (y) =>
    size = @prevViewportSize()
    @cameras[constants.VIEW_3D].top -= y*size/384
    @cameras[constants.VIEW_3D].bottom -= y*size/384
    @cameras[constants.VIEW_3D].updateProjectionMatrix()
    @flycam.hasChanged = true

  zoomIn : =>
    if @model.user.lockZoom
      @flycam.zoomInAll()
    else 
      @flycam.zoomIn(@flycam.getActivePlane())
    @updateCamViewport()

  zoomOut : =>
    if @model.user.lockZoom
      @flycam.zoomOutAll()
    else 
      @flycam.zoomOut(@flycam.getActivePlane())
    @updateCamViewport()

  setRouteClippingDistance : (value) ->
    @camDistance = 2 * value # Plane is shifted so it's <value> to the back and the front
    @updateCamViewport()

  getRouteClippingDistance : (planeID) ->
    @camDistance * @model.scaleInfo.voxelPerNM[planeID]

  updateCamViewport : ->
    scaleFactor = @model.scaleInfo.baseVoxel
    for i in [constants.PLANE_XY, constants.PLANE_YZ, constants.PLANE_XZ]
      @cameras[i].near = -@camDistance #/ @flycam.getPlaneScalingFactor(i)
      boundary     = constants.WIDTH / 2 * @flycam.getPlaneScalingFactor(i)
      @cameras[i].left  = @cameras[i].bottom = -boundary * scaleFactor
      @cameras[i].right = @cameras[i].top    =  boundary * scaleFactor
      @cameras[i].updateProjectionMatrix()
    @flycam.hasChanged = true


  bind : ->

    @model.user.on "routeClippingDistanceChanged", (value) =>
      @setRouteClippingDistance(value)