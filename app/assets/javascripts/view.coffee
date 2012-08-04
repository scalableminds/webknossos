### define
libs/flycam : Flycam
libs/flycam2 : Flycam2d
model : Model
libs/Tween : TWEEN_LIB
###
    
# global View variables
cam2d = null

# constants
# display 512px out of 512px total width and height
CAM_DISTANCE = 384/2 # alt: 384/2  #alt: 96
VIEWPORT_WIDTH = 380
PLANE_XY = 0
PLANE_YZ = 1
PLANE_XZ = 2
VIEW_3D  = 3

View =
  initialize : ->

    # The "render" div serves as a container for the canvas, that is 
    # attached to it once a renderer has been initalized.
    container = $("#render")
    # Create a 4x4 grid
    WIDTH = (container.width()-48)/2
    HEIGHT = (container.height()-48)/2

    # Initialize main THREE.js components
    @rendererxy = new THREE.WebGLRenderer({ clearColor: 0xff0000, clearAlpha: 1, antialias: true })
    @cameraxy = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 1, 1000)
    @scenexy = new THREE.Scene()

    @rendereryz = new THREE.WebGLRenderer({ clearColor: 0x0000ff, clearAlpha: 1, antialias: true })
    @camerayz = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 10000)
    @sceneyz = new THREE.Scene()

    @rendererxz = new THREE.WebGLRenderer({ clearColor: 0x00ff00, clearAlpha: 1, antialias: true })
    @cameraxz = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 10000)
    @scenexz = new THREE.Scene()

    @rendererPrev = new THREE.WebGLRenderer({ clearColor: 0xffffff, clearAlpha: 1, antialias: false })
    @cameraPrev = new THREE.OrthographicCamera(-2100, 2100, 2100, -2100, -100000, 100000)
    @scenePrev = new THREE.Scene()

    # Let's set up cameras
    # The cameras are never "moved". They only look at the scenes
    # (the trianglesplanes in particular)
    @scenexy.add(@cameraxy)
    @cameraxy.position.z = CAM_DISTANCE
    @cameraxy.lookAt(new THREE.Vector3( 0, 0, 0 ))

    @sceneyz.add(@camerayz)
    @camerayz.position.z = CAM_DISTANCE
    @camerayz.lookAt(new THREE.Vector3( 0, 0, 0 ))

    @scenexz.add(@cameraxz)
    @cameraxz.position.z = CAM_DISTANCE
    @cameraxz.lookAt(new THREE.Vector3( 0, 0, 0 ))

    @scenePrev.add(@cameraPrev)
    
    # Attach the canvas to the container
    # DEBATE: a canvas can be passed the the renderer as an argument...!?
    @rendererxy.setSize(WIDTH, HEIGHT)
    @rendereryz.setSize(WIDTH, HEIGHT)
    @rendererxz.setSize(WIDTH, HEIGHT)
    @rendererPrev.setSize(WIDTH, HEIGHT)
    container.append(@rendererxy.domElement)
    container.append(@rendereryz.domElement)
    container.append(@rendererxz.domElement)
    container.append(@rendererPrev.domElement)

    @prevControls = $('#prevControls')
    @button3D = document.createElement("input")
    @button3D.setAttribute "type", "button"
    @button3D.setAttribute "value", "3D View"
    @button3D.addEventListener "click", @changePrev3D, true
    @prevControls.append @button3D
    @buttonXY = document.createElement("input")
    @buttonXY.setAttribute "type", "button"
    @buttonXY.setAttribute "value", "XY Plane"
    @buttonXY.addEventListener "click", @changePrevXY, true
    @prevControls.append @buttonXY
    @buttonYZ = document.createElement("input")
    @buttonYZ.setAttribute "type", "button"
    @buttonYZ.setAttribute "value", "YZ Plane"
    @buttonYZ.addEventListener "click", @changePrevYZ, true
    @prevControls.append @buttonYZ
    @buttonXZ = document.createElement("input")
    @buttonXZ.setAttribute "type", "button"
    @buttonXZ.setAttribute "value", "XZ Plane"
    @buttonXZ.addEventListener "click", @changePrevXZ, true
    @prevControls.append @buttonXZ


    # This "camera" is not a camera in the traditional sense.
    # It just takes care of the global position
    cam2d = new Flycam2d VIEWPORT_WIDTH
    @setActivePlaneXY()
    
    # FPS stats
    stats = new Stats()
    stats.getDomElement().style.position = 'absolute'
    stats.getDomElement().style.left = '0px'
    stats.getDomElement().style.top = '0px'
    $("body").append stats.getDomElement() 
    @stats = stats
    @positionStats = $("#status")

    @changePrev VIEW_3D
    # start the rendering loop
    @animate()

    # Dont forget to handle window resizing!
    $(window).resize( => @.resize() )

    # refresh the scene once a bucket is loaded
    # FIXME: probably not the most elgant thing to do
    # FIXME: notifies all planes when any bucket is loaded
    $(window).on("bucketloaded", => cam2d.hasChanged = true; cam2d.newBuckets = [true, true, true]) 

  animate : ->
    @renderFunction()

    window.requestAnimationFrame => @animate()

  # This is the main render function.
  # All 3D meshes and the trianglesplane are rendered here.
  renderFunction : ->

    TWEEN.update()

    # skip rendering if nothing has changed
    # This prevents you the GPU/CPU from constantly
    # working and keeps your lap cool
    # ATTENTION: this limits the FPS to 30 FPS (depending on the keypress update frequence)
    if cam2d.hasChanged is false
      return

    @updateTrianglesplane()
    
    # update postion and FPS displays
    position2d = cam2d.getGlobalPos()
    texturePositionXY = cam2d.texturePosition[0]
    # without rounding the position becomes really long and blocks the canvas mouse input
    position2d = [Math.round(position2d[0]),Math.round(position2d[1]),Math.round(position2d[2])]
    texturePositionXY = [Math.round(texturePositionXY[0]),Math.round(texturePositionXY[1]),Math.round(texturePositionXY[2])]
    @positionStats.html "Flycam2d: #{position2d}<br />texturePositionXY: #{texturePositionXY}<br />ZoomStep #{cam2d.getZoomStep(cam2d.getActivePlane())}<br />activePlane: #{cam2d.getActivePlane()}" 
    @stats.update()

    cam2d.hasChanged = false
    @rendererxy.render @scenexy, @cameraxy
    @rendereryz.render @sceneyz, @camerayz
    @rendererxz.render @scenexz, @cameraxz
    @rendererPrev.render @scenePrev, @cameraPrev

  # Let's apply new pixels to the trianglesplane.
  # We do so by apply a new texture to it.
  updateTrianglesplane : ->
      # properties for each plane, so we can do it in a loop rather than calling each function six times...
      propsXY = {getFkt: Model.Binary.get, planeID: PLANE_XY}
      propsYZ = {getFkt: Model.Binary.get, planeID: PLANE_YZ}
      propsXZ = {getFkt: Model.Binary.get, planeID: PLANE_XZ}

      # new trianglesplane for xy
      return unless @trianglesplanexy
      gxy = @trianglesplanexy
      gxy.props = propsXY

      # new trianglesplane for yz
      return unless @trianglesplaneyz
      gyz = @trianglesplaneyz
      gyz.props = propsYZ

      # new trianglesplane for xz
      return unless @trianglesplanexz
      gxz = @trianglesplanexz
      gxz.props = propsXZ

      # new trianglesplanes for preview
      return unless @trianglesplanePrevXY
      gpxy = @trianglesplanePrevXY
      gpxy.props = propsXY
      return unless @trianglesplanePrevYZ
      gpyz = @trianglesplanePrevYZ
      gpyz.props = propsYZ
      return unless @trianglesplanePrevXZ
      gpxz = @trianglesplanePrevXZ
      gpxz.props = propsXZ
      gbxy = @borderPrevXY
      gbxy.props = propsXY
      gbyz = @borderPrevYZ
      gbyz.props = propsYZ
      gbxz = @borderPrevXZ
      gbxz.props = propsXZ

      # sends current position to Model for preloading data
      # NEW with direction vector
      # Model.Binary.ping cam2d.getGlobalPos(), cam2d.getDirection(), cam2d.getZoomStep(PLANE_XY)
      Model.Binary.ping cam2d.getGlobalPos(), cam2d.getZoomStep(PLANE_XY)

      # sends current position to Model for caching route
      Model.Route.put cam2d.getGlobalPos()

      globalPos = cam2d.getGlobalPos()
      # Translating ThreeJS' coordinate system to the preview's one
      globalPosVec = new THREE.Vector3(globalPos[0], 2500-globalPos[2], globalPos[1])
      
      i = 0       # counts which plane is used
      for plane in [gxy, gyz, gxz, gpxy, gpxz, gpyz, gbxy, gbyz, gbxz]
        i++
        if cam2d.needsUpdate(plane.props.planeID) and i<=3
          # TODO: Why don't those lines work? it would get rid of that huge switch statement 
          #
          #plane.props.getFkt(cam2d.getGlobalPos(), cam2d.getZoomStep(plane.props.planeID)).done (buffer) ->
          #  plane.texture.image.data.set(buffer)
          switch plane.props.planeID
            when PLANE_XY
              Model.Binary.get(cam2d.getGlobalPos(), cam2d.getZoomStep(PLANE_XY), [0, 0, 100, 100], 0)#.done (buffer) ->
              #plane.texture.image.data.set(buffer)
           # when PLANE_YZ
           #   Model.Binary.get(cam2d.getGlobalPos(), cam2d.getZoomStep(PLANE_XY), [0, 0, 100, 100], 0).done (buffer) ->
           #     plane.texture.image.data.set(buffer)
           # when PLANE_XZ
           #  Model.Binary.get(cam2d.getGlobalPos(), cam2d.getZoomStep(PLANE_XY), [0, 0, 100, 100], 0).done (buffer) ->
           #    plane.texture.image.data.set(buffer)
          cam2d.notifyNewTexture plane.props.planeID
        
        else if i>=4 and i<=6
          switch plane.props.planeID
            when PLANE_XY then plane.texture = gxy.texture.clone()
            when PLANE_YZ then plane.texture = gyz.texture.clone()
            when PLANE_XZ then plane.texture = gxz.texture.clone()
        
        offsets = cam2d.getOffsets plane.props.planeID
        scalingFactor = cam2d.getTextureScalingFactor plane.props.planeID
        if i>=4
          sFactor = cam2d.getPlaneScalingFactor plane.props.planeID
          plane.scale.x = plane.scale.y = plane.scale.z = sFactor
        if i<=6
          plane.texture.needsUpdate = true
          plane.material.map = plane.texture
        if i>=4 and i<=6 then plane.position = globalPosVec
        else if i>=7 then plane.position = new THREE.Vector3(globalPosVec.x-1, globalPosVec.y-1, globalPosVec.z-1)
        else
          plane.material.map.repeat.x = VIEWPORT_WIDTH*scalingFactor / 508;
          plane.material.map.repeat.y = VIEWPORT_WIDTH*scalingFactor / 508;
          plane.material.map.offset.x = offsets[0] / 508;
          plane.material.map.offset.y = offsets[1] / 508;
  
  # Adds a new Three.js geometry to the scene.
  # This provides the public interface to the GeometryFactory.
  addGeometryXY : (geometry) ->
    @scenexy.add geometry

  addGeometryYZ : (geometry) ->
    @sceneyz.add geometry

  addGeometryXZ : (geometry) ->
    @scenexz.add geometry

  addGeometryPrev : (geometry) ->
    @scenePrev.add geometry

  changePrev : (id) ->
    # In order for the rotation to be correct, it is not sufficient
    # to just use THREEJS' lookAt() function, because it may still
    # look at the plane in a wrong angle. Therefore, the rotation
    # has to be hard coded.
    @tween = new TWEEN.Tween({ cameraPrev: @cameraPrev, x: @cameraPrev.position.x, y: @cameraPrev.position.y, z: @cameraPrev.position.z, xRot: @cameraPrev.rotation.x, yRot: @cameraPrev.rotation.y, zRot: @cameraPrev.rotation.z, l: @cameraPrev.left, r: @cameraPrev.right, t: @cameraPrev.top, b: @cameraPrev.bottom})
    switch id
      when VIEW_3D
        scale = 2100
        @tween.to({  x: 4000, y: 4000, z: 5000, xRot: @degToRad(-36.25), yRot: @degToRad(30.6), zRot: @degToRad(20.47), l: -scale, r: scale, t: scale, b: -scale}, 800)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (-36.25, 30.6, 20.47) -> (-36.25, 30.6, 20.47)
      when PLANE_XY
        scale = 1600
        @tween.to({  x: 1250, y: 4000, z: 1250, xRot: @degToRad(-90), yRot: @degToRad(0), zRot: @degToRad(0), l: -scale, r: scale, t: scale, b: -scale}, 800)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (-90, 0, 90) -> (-90, 0, 0)
      when PLANE_YZ
        scale = 1600
        @tween.to({  x: 4000, y: 1250, z: 1250, xRot: @degToRad(-90), yRot: @degToRad(90), zRot: @degToRad(0), l: -scale, r: scale, t: scale, b: -scale}, 800)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (0, 90, 0) -> (-90, 90, 0)
      when PLANE_XZ
        scale = 1600
        @tween.to({  x: 1250, y: 1250, z: 4000, xRot: @degToRad(0), yRot: @degToRad(0), zRot: @degToRad(0), l: -scale, r: scale, t: scale, b: -scale}, 800)
        .onUpdate(@updateCameraPrev)
        .start()
        #rotation: (0, 0, 0) -> (0, 0, 0)
    cam2d.hasChanged = true

  degToRad : (deg) -> deg/180*Math.PI

  updateCameraPrev : ->
    @cameraPrev.position = new THREE.Vector3(@x, @y, @z)
    @cameraPrev.rotation = new THREE.Vector3(@xRot, @yRot, @zRot)
    @cameraPrev.left = @l
    @cameraPrev.right = @r
    @cameraPrev.top = @t
    @cameraPrev.bottom = @b
    @cameraPrev.updateProjectionMatrix()
    cam2d.hasChanged = true

  changePrev3D : => View.changePrev(VIEW_3D)
  changePrevXY : => View.changePrev(PLANE_XY)
  changePrevYZ : => View.changePrev(PLANE_YZ)
  changePrevXZ : => View.changePrev(PLANE_XZ)

  #Apply a single draw (not used right now)
  draw : ->
    #FIXME: this is dirty
    cam2d.hasChanged = true

  #Call this after the canvas was resized to fix the viewport
  resize : ->
    #FIXME: Is really the window's width or rather the DIV's?
    container = $("#render")
    WIDTH = (container.width()-49)/2
    HEIGHT = (container.height()-49)/2

    @rendererxy.setSize( WIDTH, HEIGHT )
    @rendereryz.setSize( WIDTH, HEIGHT )
    @rendererxz.setSize( WIDTH, HEIGHT )
    @rendererPrev.setSize( WIDTH, HEIGHT)
    @cameraxy.aspect  = WIDTH / HEIGHT
    @cameraxy.updateProjectionMatrix()
    @camerayz.aspect  = WIDTH / HEIGHT
    @camerayz.updateProjectionMatrix()
    @cameraxz.aspect  = WIDTH / HEIGHT
    @cameraxz.updateProjectionMatrix()
    @cameraPrev.aspect = WIDTH / HEIGHT
    @cameraPrev.updateProjectionMatrix()
    @draw()

############################################################################
#Interface for Controller
  # TODO: Some of those are probably obsolete

  setGlobalPos : (pos) ->
    cam2d.setGlobalPos(pos)

  getGlobalPos : ->
    cam2d.getGlobalPos()

  setDirection : (direction) ->
    cam2d.setDirection direction

  move : (p) ->
    cam2d.move p

  moveActivePlane : (p) ->
    switch (cam2d.getActivePlane())
      when PLANE_XY
        cam2d.moveActivePlane p
      when PLANE_YZ
        cam2d.move [p[2], p[1], p[0]]
      when PLANE_XZ
        cam2d.move [p[0], p[2], p[1]]

  #FIXME: why can't I call move() from within this function?
  moveX : (x) -> 
    cam2d.moveActivePlane [x, 0, 0]

  moveY : (y) ->
    cam2d.moveActivePlane [0, y, 0]
  
  moveZ : (z) ->
    cam2d.moveActivePlane [0, 0, z]

  prevViewportSite : =>
    (View.cameraPrev.right - View.cameraPrev.left)         # always quadratic

  zoomPrev : (value) =>
    factor = Math.pow(0.9, value)
    middleX = (View.cameraPrev.left + View.cameraPrev.right)/2
    middleY = (View.cameraPrev.bottom + View.cameraPrev.top)/2
    size = View.prevViewportSite()
    View.cameraPrev.left = middleX - factor*size/2
    View.cameraPrev.right = middleX + factor*size/2
    View.cameraPrev.top = middleY + factor*size/2
    View.cameraPrev.bottom = middleY - factor*size/2
    View.cameraPrev.updateProjectionMatrix()
    cam2d.hasChanged = true

  movePrevX : (x) =>
    View.cameraPrev.left += x*View.prevViewportSite()/384
    View.cameraPrev.right += x*View.prevViewportSite()/384
    View.cameraPrev.updateProjectionMatrix()
    cam2d.hasChanged = true

  movePrevY : (y) =>
    View.cameraPrev.top -= y*View.prevViewportSite()/384
    View.cameraPrev.bottom -= y*View.prevViewportSite()/384
    View.cameraPrev.updateProjectionMatrix()
    cam2d.hasChanged = true
  
  scaleTrianglesPlane : (delta) ->
    @x = 1 unless @x
    if (@x+delta > 0.75) and (@x+delta < 1.5)
      @x += Number(delta)
      WIDTH = HEIGHT = @x * 384
      container = $("#render")
      container.width(2 * WIDTH + 48)
      container.height(2 * HEIGHT + 48)

      # scales the 3D-view controls
      prevControl = $("#prevControls")
      prevControl.css({top: @x * 440 + "px", left: @x * 420 + "px"})

      @resize()

  zoomIn : ->
    cam2d.zoomIn(cam2d.getActivePlane())

  #todo: validation in Model
  zoomOut : ->
    cam2d.zoomOut(cam2d.getActivePlane())

  setActivePlane : (activePlane) ->
    cam2d.setActivePlane activePlane
    cam2d.hasChanged = true

  setActivePlaneXY : ->
    cam2d.setActivePlane PLANE_XY
    $("canvas")[0].style.borderColor = "#DD0000 #00DD00"
    $("canvas")[1].style.borderColor = "#C7D1D8"
    $("canvas")[2].style.borderColor = "#C7D1D8"
    cam2d.hasChanged = true

  setActivePlaneYZ : ->
    cam2d.setActivePlane PLANE_YZ
    $("canvas")[0].style.borderColor = "#C7D1D8"
    $("canvas")[1].style.borderColor = "#0000DD 00DD00"
    $("canvas")[2].style.borderColor = "#C7D1D8"
    cam2d.hasChanged = true

  setActivePlaneXZ : ->
    cam2d.setActivePlane PLANE_XZ
    $("canvas")[0].style.borderColor = "#C7D1D8"
    $("canvas")[1].style.borderColor = "#C7D1D8"
    $("canvas")[2].style.borderColor = "#DD0000 0000DD"
    cam2d.hasChanged = true

  setWaypointXY : (position) ->
    curGlobalPos = cam2d.getGlobalPos()
    curZoomStep = cam2d.getZoomStep(PLANE_XY) + 1
    # calculate the global position of the rightclick
    View.setWaypoint [curGlobalPos[0] - 192/curZoomStep + position[0]/curZoomStep, curGlobalPos[1] - 192/curZoomStep + position[1]/curZoomStep, curGlobalPos[2]]

  setWaypointYZ : (position) ->
    curGlobalPos = cam2d.getGlobalPos()
    curZoomStep = cam2d.getZoomStep(PLANE_XZ) + 1
    # calculate the global position of the rightclick
    View.setWaypoint [curGlobalPos[0] - 192/curZoomStep + position[0]/curZoomStep, curGlobalPos[1], curGlobalPos[2] - 192/curZoomStep + position[1]/curZoomStep]

  setWaypointXZ : (position) ->
    curGlobalPos = cam2d.getGlobalPos()
    curZoomStep = cam2d.getZoomStep(PLANE_YZ) + 1
    # calculate the global position of the rightclick
    View.setWaypoint [curGlobalPos[0], curGlobalPos[1] - 192/curZoomStep + position[0]/curZoomStep, curGlobalPos[2] - 192/curZoomStep + position[1]/curZoomStep]

  setWaypoint : (position) ->
    unless @curIndex
      @curIndex = 1 
      @route.geometry.vertices[0] = new THREE.Vector3(2046, 2500 - 470, 1036)
    # resize buffer if route gets too long
    if @curIndex >= @maxRouteLen
      @maxRouteLen *= 2
      @createRoute @maxRouteLen, @route
    # Translating ThreeJS' coordinate system to the preview's one
    @route.geometry.vertices[@curIndex] = new THREE.Vector3(position[0], 2500 - position[2], position[1])
    @route.geometry.verticesNeedUpdate = true
    @curIndex += 1
    cam2d.hasChanged = true

  createRoute : (maxRouteLen, lastRoute) ->
    # create route to show in previewBox and pre-allocate buffer
    @maxRouteLen = maxRouteLen
    routeGeometry = new THREE.Geometry()
    i = 0
    if lastRoute?
      for vertex in lastRoute.geometry.vertices
        routeGeometry.vertices.push(vertex)
      i = @maxRouteLen / 2
    while i < maxRouteLen
      # workaround to hide the unused vertices
      routeGeometry.vertices.push(new THREE.Vector2(0, 0))
      i += 1

    routeGeometry.dynamic = true
    route = new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({color: 0xff0000, linewidth: 2}))
    @route = route
    @addGeometryPrev route
