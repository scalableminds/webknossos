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

class SvCameraController

  # The Sceleton View Camera Controller handles the orthographic camera which is looking at the Skeleton
  # View. It provides methods to set a certain View (animated).

  constructor : (camera, flycam, upperBoundary, skeletonView) ->
    @camera        = camera
    @flycam        = flycam
    @upperBoundary = upperBoundary
    @skeletonView  = skeletonView

  changePrev : (id) ->
    # In order for the rotation to be correct, it is not sufficient
    # to just use THREEJS' lookAt() function, because it may still
    # look at the plane in a wrong angle. Therefore, the rotation
    # has to be hard coded.
    #
    # CORRECTION: You're telling lies, you need to use the up vector...

    @tween = new TWEEN.Tween({  camera: @camera
                                flycam: @flycam
                                sv : @skeletonView
                                #texts: @texts
                                x: @camera.position.x
                                y: @camera.position.y
                                z: @camera.position.z
                                xRot: @camera.rotation.x
                                yRot: @camera.rotation.y
                                zRot: @camera.rotation.z
                                l: @camera.left
                                r: @camera.right
                                t: @camera.top
                                b: @camera.bottom })
    b = @upperBoundary
    switch id
      when VIEW_3D
        scale = Math.sqrt(b[0]*b[0]+b[1]*b[1])/1.8
        @tween.to({  x: 4000, y: 4000, z: 5000, xRot: @degToRad(-36.25), yRot: @degToRad(30.6), zRot: @degToRad(20.47), l: -scale+scale*(b[0]/(b[0]+b[1])-0.5), r: scale+scale*(b[0]/(b[0]+b[1])-0.5), t: scale-scale*0.1, b: -scale-scale*0.1}, 800)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (-36.25, 30.6, 20.47) -> (-36.25, 30.6, 20.47)
      when PLANE_XY
        scale = (Math.max b[0], b[1])/1.75
        @tween.to({  x: b[0]/2, y: 4000, z: b[1]/2, xRot: @degToRad(-90), yRot: @degToRad(0), zRot: @degToRad(0), l: -scale, r: scale, t: scale+scale*0.12, b: -scale+scale*0.12}, 800)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (-90, 0, 90) -> (-90, 0, 0)
      when PLANE_YZ
        scale = (Math.max b[1], b[2])/1.75
        @tween.to({  x: 4000, y: b[2]/2, z: b[1]/2, xRot: @degToRad(-90), yRot: @degToRad(90), zRot: @degToRad(0), l: -scale, r: scale, t: scale+scale*0.12, b: -scale+scale*0.12}, 800)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (0, 90, 0) -> (-90, 90, 0)
      when PLANE_XZ
        scale = (Math.max b[0], b[2])/1.75
        @tween.to({  x: b[0]/2, y: b[2]/2, z: 4000, xRot: @degToRad(0), yRot: @degToRad(0), zRot: @degToRad(0), l: -scale, r: scale, t: scale+scale*0.12, b: -scale+scale*0.12}, 800)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (0, 0, 0) -> (0, 0, 0)
    @cam2d.hasChanged = true

  degToRad : (deg) -> deg/180*Math.PI

  updateCameraPrev : ->
    @camera.position = new THREE.Vector3(@x, @y, @z)
    @camera.rotation = new THREE.Vector3(@xRot, @yRot, @zRot)
    @camera.left = @l
    @camera.right = @r
    @camera.top = @t
    @camera.bottom = @b

    @sv.setTextRotation(@xRot, @yRot, @zRot)
    @camera.updateProjectionMatrix()
    @cam2d.hasChanged = true
    
  prevViewportSize : ->
    (@camera.right - @camera.left)         # always quadratic

  zoomPrev : (value) =>
    factor = Math.pow(0.9, value)
    middleX = (@camera.left + @camera.right)/2
    middleY = (@camera.bottom + @camera.top)/2
    size = @prevViewportSize()
    @camera.left = middleX - factor*size/2
    @camera.right = middleX + factor*size/2
    @camera.top = middleY + factor*size/2
    @camera.bottom = middleY - factor*size/2
    @camera.updateProjectionMatrix()

    @rayThreshold = (4)*(@camera.right - @camera.left)/384

    @cam2d.hasChanged = true

  movePrevX : (x) =>
    size = @prevViewportSize()
    @camera.left += x*size/384
    @camera.right += x*size/384
    @camera.updateProjectionMatrix()
    @cam2d.hasChanged = true

  movePrevY : (y) =>
    size = @prevViewportSize()
    @camera.top -= y*size/384
    @camera.bottom -= y*size/384
    @camera.updateProjectionMatrix()
    @cam2d.hasChanged = true