### define
model : Model
view : View
libs/threejs/fonts/helvetiker_regular.typeface : helvetiker
model/game : Game
###


PLANE_XY         = 0
PLANE_YZ         = 1
PLANE_XZ         = 2
VIEW_3D          = 3
VIEWPORT_WIDTH   = 380
WIDTH            = 384

class CameraController

  # The Sceleton View Camera Controller handles the orthographic camera which is looking at the Skeleton
  # View. It provides methods to set a certain View (animated).

  constructor : (cameras, flycam, model, upperBoundary, skeletonView) ->
    @cameras       = cameras
    @flycam        = flycam
    @model         = model
    @upperBoundary = upperBoundary
    @skeletonView  = skeletonView

    @updateCamViewport()
    @cameras[VIEW_3D].near = -100000
    @cameras[VIEW_3D].far  =  100000

  update : =>
    gPos = @flycam.getGlobalPos()
    @cameras[PLANE_XY].position = new THREE.Vector3(gPos[0]    , gPos[1]    , gPos[2] - 1)
    @cameras[PLANE_YZ].position = new THREE.Vector3(gPos[0] + 1, gPos[1]    , gPos[2])
    @cameras[PLANE_XZ].position = new THREE.Vector3(gPos[0]    , gPos[1] + 1, gPos[2])

  changePrev : (id) ->
    # In order for the rotation to be correct, it is not sufficient
    # to just use THREEJS' lookAt() function, because it may still
    # look at the plane in a wrong angle. Therefore, the rotation
    # has to be hard coded.
    #
    # CORRECTION: You're telling lies, you need to use the up vector...

    camera = @cameras[VIEW_3D]
    b = @upperBoundary
    time = 800
    console.log "From up: " + [camera.up.x, camera.up.y, camera.up.z]
    @tween = new TWEEN.Tween({  middle: new THREE.Vector3(b[0]/2, b[1]/2, b[2]/2), upX: camera.up.x, upY: camera.up.y, upZ: camera.up.z, camera: camera,flycam: @flycam,sv : @skeletonView,x: camera.position.x,y: camera.position.y,z: camera.position.z,l: camera.left,r: camera.right,t: camera.top,b: camera.bottom })
    switch id
      when VIEW_3D
        scale = Math.sqrt(b[0]*b[0]+b[1]*b[1])/1.8
        console.log "To up: " + [0, 0, -1]
        @tween.to({  x: b[0]*0.8, y: b[1], z: b[2] / 5, upX: 0, upY: 0, upZ: -1, l: -scale+scale*(b[0]/ (b[0]+b[1])-0.5), r: scale+scale*(b[0]/(b[0]+b[1])-0.5), t: scale-scale*0.1, b: -scale-scale*0.1}, time)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (-36.25, 30.6, 20.47) -> (-36.25, 30.6, 20.47)
      when PLANE_XY
        scale = (Math.max b[0], b[1])/1.75
        @tween.to({  x: b[0]/2, y: b[1]/2, z: 0, upX: 0, upY: -1, upZ: 0, l: -scale, r: scale, t: scale+scale*0.12, b: -scale+scale*0.12}, time)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (-90, 0, 90) -> (-90, 0, 0)
      when PLANE_YZ
        scale = (Math.max b[1], b[2])/1.75
        @tween.to({  x: b[0], y: b[1]/2, z: b[2]/2, upX: 0, upY: -1, upZ: 0, l: -scale, r: scale, t: scale+scale*0.12, b: -scale+scale*0.12}, time)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (0, 90, 0) -> (-90, 90, 0)
      when PLANE_XZ
        scale = (Math.max b[0], b[2])/1.75
        @tween.to({  x: b[0]/2, y: b[1], z: b[2]/2, upX: 0, upY: 0, upZ: -1, l: -scale, r: scale, t: scale+scale*0.12, b: -scale+scale*0.12}, time)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (0, 0, 0) -> (0, 0, 0)
    @flycam.hasChanged = true

  degToRad : (deg) -> deg/180*Math.PI

  changePrevXY : => @changePrev(PLANE_XY)
  changePrevYZ : => @changePrev(PLANE_YZ)
  changePrevXZ : => @changePrev(PLANE_XZ)
  changePrevSV : => @changePrev(VIEW_3D)

  updateCameraPrev : ->
    @camera.position = new THREE.Vector3(@x, @y, @z)
    @camera.left = @l
    @camera.right = @r
    @camera.top = @t
    @camera.bottom = @b
    @camera.up = new THREE.Vector3(@upX, @upY, @upZ)
    @camera.lookAt(@middle)

    @flycam.setRayThreshold(@camera.right, @camera.left)

    @sv.setTextRotation(@xRot, @yRot, @zRot)
    @camera.updateProjectionMatrix()
    @flycam.hasChanged = true
    
  prevViewportSize : ->
    (@cameras[VIEW_3D].right - @cameras[VIEW_3D].left)         # always quadratic

  zoomPrev : (value) =>
    camera = @cameras[VIEW_3D]
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
    @cameras[VIEW_3D].left += x*size/384
    @cameras[VIEW_3D].right += x*size/384
    @cameras[VIEW_3D].updateProjectionMatrix()
    @flycam.hasChanged = true

  movePrevY : (y) =>
    size = @prevViewportSize()
    @cameras[VIEW_3D].top -= y*size/384
    @cameras[VIEW_3D].bottom -= y*size/384
    @cameras[VIEW_3D].updateProjectionMatrix()
    @flycam.hasChanged = true

  zoomIn : =>
    if @model.User.Configuration.lockZoom
      @flycam.zoomInAll()
    else 
      @flycam.zoomIn(@flycam.getActivePlane())
    @updateCamViewport()

  zoomOut : =>
    if @model.User.Configuration.lockZoom
      @flycam.zoomOutAll()
    else 
      @flycam.zoomOut(@flycam.getActivePlane())
    @updateCamViewport()

  setRouteClippingDistance : (value) ->
    @camDistance = 2 * value # Plane is shifted so it's <value> to the back and the front
    @updateCamViewport()

  updateCamViewport : ->
    for i in [0..2]
      @cameras[i].near = -@camDistance / @flycam.getPlaneScalingFactor(i)
      boundary     = WIDTH / 2 * @flycam.getPlaneScalingFactor(i)
      @cameras[i].left  = @cameras[i].bottom = -boundary
      @cameras[i].right = @cameras[i].top    =  boundary
      @cameras[i].updateProjectionMatrix()
    @flycam.hasChanged = true