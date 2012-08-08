### define
libs/flycam : Flycam
libs/flycam2 : Flycam2d
model : Model
libs/Tween : TWEEN_LIB
libs/datgui/dat.gui : DatGui
model/game : Game
###
    
# global View variables
cam2d = null

# constants
# display 512px out of 512px total width and height
#CAM_DISTANCE = 384/2 # alt: 384/2  #alt: 96
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
    @curWidth = WIDTH = (container.width()-48)/2
    HEIGHT = (container.height()-48)/2
    @x = 1

    # create GUI
    text = {message: "Test", speed: 0.5, checkbox: true}
    gui  = new dat.GUI()
    gui.add text, "message"
    gui.add text, "speed", -5, 5
    $("#optionswindow").append gui.domElement
    #$(gui.domElement).css
    #  position : 'absolute'
    #  left : '220px'
    #  top : '260px'
    #  height : '500px'
    f1 = gui.addFolder("Folder")
    f1.add text, "checkbox"

    # Initialize main THREE.js components
    # Max. distance the route may have from the main plane in order to be displayed:
    @camDistance = 40
    colors    = [0xff0000, 0x0000ff, 0x00ff00, 0xffffff]
    @renderer = new Array(4)
    @camera   = new Array(4)
    @scene    = new Array(4)
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ, VIEW_3D]
      camDistance  = if i==VIEW_3D then 100000 else @camDistance
      @renderer[i] = new THREE.WebGLRenderer({clearColor: colors[i], clearAlpha: 1, antialias: false})
      @camera[i]   = new THREE.OrthographicCamera(-192, 192, 192, -192, -camDistance, camDistance)
      @scene[i]    = new THREE.Scene()

      # Let's set up cameras
      # The cameras are never "moved". They only look at the scenes
      # (the trianglesplanes in particular)
      @scene[i].add @camera[i]
      @camera[i].position.z = 1
      @camera[i].lookAt(new THREE.Vector3( 0, 0, 0))

      # Attach the canvas to the container
      # DEBATE: a canvas can be passed the the renderer as an argument...!?
      @renderer[i].setSize WIDTH, HEIGHT
      container.append @renderer[i].domElement

    @prevControls = $('#prevControls')
    values        = ["XY Plane", "YZ Plane", "XZ Plane", "3D View"]
    callbacks     = [@changePrevXY, @changePrevYZ, @changePrevXZ, @changePrev3D]
    buttons       = new Array(4)
    for i in [VIEW_3D, PLANE_XY, PLANE_YZ, PLANE_XZ]
      buttons[i] = document.createElement "input"
      buttons[i].setAttribute "type", "button"
      buttons[i].setAttribute "value", values[i]
      buttons[i].addEventListener "click", callbacks[i], true
      @prevControls.append buttons[i]

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

    @first = true
    @newTextures = [true, true, true, true]
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

    @updateTrianglesplane()
    
    # update postion and FPS displays
    position2d = cam2d.getGlobalPos()
    texturePositionXY = cam2d.texturePosition[0]
    # without rounding the position becomes really long and blocks the canvas mouse input
    position2d = [Math.round(position2d[0]),Math.round(position2d[1]),Math.round(position2d[2])]
    texturePositionXY = [Math.round(texturePositionXY[0]),Math.round(texturePositionXY[1]),Math.round(texturePositionXY[2])]
    @positionStats.html "Flycam2d: #{position2d}<br />texturePositionXY: #{texturePositionXY}<br />ZoomStep #{cam2d.getIntegerZoomStep(cam2d.getActivePlane())}<br />activePlane: #{cam2d.getActivePlane()}" 
    @stats.update()

    @newTextures[VIEW_3D] = @newTextures[0] or @newTextures[1] or @newTextures[2]
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ, VIEW_3D]
      if cam2d.hasChanged or @newTextures[i]
        @renderer[i].render @scene[i], @camera[i]
    cam2d.hasChanged = false
    @newTextures = [false, false, false, false]

  # Let's apply new pixels to the trianglesplane.
  # We do so by apply a new texture to it.
  updateTrianglesplane : ->
      return unless @meshes
      return unless @prevBorders

      # sends current position to Model for preloading data
      # NEW with direction vector
      # Model.Binary.ping cam2d.getGlobalPos(), cam2d.getDirection(), cam2d.getZoomStep(PLANE_XY)
      Model.Binary.ping cam2d.getGlobalPos(), cam2d.getIntegerZoomSteps()

      # sends current position to Model for caching route
      Model.Route.put cam2d.getGlobalPos()

      globalPos = cam2d.getGlobalPos()
      # Translating ThreeJS' coordinate system to the preview's one
      globalPosVec = new THREE.Vector3(globalPos[0], Game.dataSet.upperBoundary[1]-globalPos[2], globalPos[1])
      
      if @first==true and Game.dataSet           # initialize Preview
        @changePrev VIEW_3D
        @first = false

      for dimension in [PLANE_XY, PLANE_YZ, PLANE_XZ]
        if cam2d.needsUpdate dimension
          cam2d.notifyNewTexture dimension
            
        plane = @meshes[0][dimension]

        Model.Binary.get(cam2d.getTexturePosition(dimension), cam2d.getIntegerZoomStep(dimension), cam2d.getArea(dimension), dimension).done (buffer) ->
          if buffer
            plane.texture.image.data.set(buffer)
            View.newTextures[dimension] = true

        @newTextures[dimension] |= cam2d.hasChanged
        if !@newTextures[dimension]
          continue
          
        @meshes[1][dimension].texture = @meshes[0][dimension].texture.clone()
        @meshes[1][dimension].position = globalPosVec
        sFactor = cam2d.getPlaneScalingFactor dimension
        scale   = @meshes[1][dimension].scale
        scale.x = scale.y = scale.z = sFactor

        @meshes[0][dimension].texture.needsUpdate = true
        @meshes[0][dimension].material.map = @meshes[0][dimension].texture
        @meshes[1][dimension].texture.needsUpdate = true
        @meshes[1][dimension].material.map = @meshes[1][dimension].texture
        
        offsets = cam2d.getOffsets dimension
        scalingFactor = cam2d.getTextureScalingFactor dimension
        map = @meshes[0][dimension].material.map
        map.repeat.x = VIEWPORT_WIDTH*scalingFactor / 508;
        map.repeat.y = VIEWPORT_WIDTH*scalingFactor / 508;
        map.offset.x = offsets[0] / 508;
        map.offset.y = offsets[1] / 508;

        @prevBorders[dimension].position = globalPosVec
        sFactor = cam2d.getPlaneScalingFactor dimension
        @prevBorders[dimension].scale = new THREE.Vector3(sFactor, sFactor, sFactor)
        
  
  # Adds a new Three.js geometry to the scene.
  # This provides the public interface to the GeometryFactory.
  addGeometry : (planeID, geometry) ->
    @scene[planeID].add geometry

  changePrev : (id) ->
    # In order for the rotation to be correct, it is not sufficient
    # to just use THREEJS' lookAt() function, because it may still
    # look at the plane in a wrong angle. Therefore, the rotation
    # has to be hard coded.
    @tween = new TWEEN.Tween({ texts: @texts, camera: @camera[VIEW_3D], x: @camera[VIEW_3D].position.x, y: @camera[VIEW_3D].position.y, z: @camera[VIEW_3D].position.z, xRot: @camera[VIEW_3D].rotation.x, yRot: @camera[VIEW_3D].rotation.y, zRot: @camera[VIEW_3D].rotation.z, l: @camera[VIEW_3D].left, r: @camera[VIEW_3D].right, t: @camera[VIEW_3D].top, b: @camera[VIEW_3D].bottom})
    b = Game.dataSet.upperBoundary
    switch id
      when VIEW_3D
        scale = Math.sqrt(b[0]*b[0]+b[1]*b[1]+b[2]*b[2])/1.9
        @tween.to({  x: 4000, y: 4000, z: 5000, xRot: @degToRad(-36.25), yRot: @degToRad(30.6), zRot: @degToRad(20.47), l: -scale, r: scale, t: scale+scale*0.25, b: -scale+scale*0.25}, 800)
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
    cam2d.hasChanged = true

  degToRad : (deg) -> deg/180*Math.PI

  updateCameraPrev : ->
    @camera.position = new THREE.Vector3(@x, @y, @z)
    @camera.rotation = new THREE.Vector3(@xRot, @yRot, @zRot)
    @camera.left = @l
    @camera.right = @r
    @camera.top = @t
    @camera.bottom = @b
    if @texts
      for text in @texts
        text.rotation = new THREE.Vector3(@xRot, @yRot, @zRot)
    @camera.updateProjectionMatrix()
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

    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ, VIEW_3D]
      @renderer[i].setSize( WIDTH, HEIGHT)
      @camera[i].aspect = WIDTH / HEIGHT
      @camera[i].updateProjectionMatrix()
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

  # Should not be used anymore
  #move : (p) ->
  #  cam2d.move p

  moveActivePlane : (p) ->
    cam2d.moveActivePlane p
    @updateRoute()

  #FIXME: why can't I call move() from within this function?
  moveX : (x) -> 
    cam2d.moveActivePlane [x, 0, 0]
    View.updateRoute()

  moveY : (y) ->
    cam2d.moveActivePlane [0, y, 0]
    View.updateRoute()
  
  moveZ : (z) ->
    cam2d.moveActivePlane [0, 0, z]
    View.updateRoute()

  prevViewportSize : =>
    (View.camera[VIEW_3D].right - View.camera[VIEW_3D].left)         # always quadratic

  zoomPrev : (value) =>
    factor = Math.pow(0.9, value)
    middleX = (View.camera[VIEW_3D].left + View.camera[VIEW_3D].right)/2
    middleY = (View.camera[VIEW_3D].bottom + View.camera[VIEW_3D].top)/2
    size = View.prevViewportSize()
    View.camera[VIEW_3D].left = middleX - factor*size/2
    View.camera[VIEW_3D].right = middleX + factor*size/2
    View.camera[VIEW_3D].top = middleY + factor*size/2
    View.camera[VIEW_3D].bottom = middleY - factor*size/2
    View.camera[VIEW_3D].updateProjectionMatrix()

    View.rayThreshold = (4)*(View.camera[VIEW_3D].right - View.camera[VIEW_3D].left)/384

    cam2d.hasChanged = true

  movePrevX : (x) =>
    size = View.prevViewportSize()
    View.camera[VIEW_3D].left += x*size/384
    View.camera[VIEW_3D].right += x*size/384
    View.camera[VIEW_3D].updateProjectionMatrix()
    cam2d.hasChanged = true

  movePrevY : (y) =>
    size = View.prevViewportSize()
    View.camera[VIEW_3D].top -= y*size/384
    View.camera[VIEW_3D].bottom -= y*size/384
    View.camera[VIEW_3D].updateProjectionMatrix()
    cam2d.hasChanged = true
  
  scaleTrianglesPlane : (delta) ->
    @x = 1 unless @x
    if (@x+delta > 0.75) and (@x+delta < 1.5)
      @x += Number(delta)
      View.curWidth = WIDTH = HEIGHT = @x * 384
      container = $("#render")
      container.width(2 * WIDTH + 48)
      container.height(2 * HEIGHT + 48)
      # set scale factor in view
      View.x = @x

      # scales the 3D-view controls
      prevControl = $("#prevControls")
      prevControl.css({top: @x * 440 + "px", left: @x * 420 + "px"})

      @resize()

  zoomIn : ->
    if Model.User.Configuration.lockZoom
      cam2d.zoomInAll()
    else 
      cam2d.zoomIn(cam2d.getActivePlane())
    View.updateRoute()
    View.updateCamDistance()

  #todo: validation in Model
  zoomOut : ->
    if Model.User.Configuration.lockZoom
      cam2d.zoomOutAll()
    else 
      cam2d.zoomOut(cam2d.getActivePlane())
    View.updateRoute()
    View.updateCamDistance()

  updateCamDistance : ->
    for i in [0..2]
      @camera[i].near = - @camDistance/cam2d.getPlaneScalingFactor(i)
      @camera[i].updateProjectionMatrix()
    cam2d.hasChanged = true

  setRouteClippingDistance : (value) ->
    @camDistance = value
    @updateCamDistance()

  setDisplayCrosshair : (value) ->
    if View.crosshairs
      for plane in @crosshairs
        for line in plane
          line.visible = value

  setDisplayPreview : (planeID, value) ->
    if View.meshes
      View.meshes[1][planeID].visible = value
      cam2d.hasChanged = true;

  setActivePlaneXY : ->
    View.setActivePlane PLANE_XY

  setActivePlaneYZ : ->
    View.setActivePlane PLANE_YZ

  setActivePlaneXZ : ->
    View.setActivePlane PLANE_XZ

  setActivePlane : (planeID) ->
    cam2d.setActivePlane planeID
    for i in [0..2]
      $("canvas")[i].style.borderColor = if i==planeID then "#f8f800" else "#C7D1D8"
    cam2d.hasChanged = true

  setWaypoint : (position) ->
    curGlobalPos = cam2d.getGlobalPos()
    activePlane  = cam2d.getActivePlane()
    zoomFactor   = cam2d.getPlaneScalingFactor activePlane
    # calculate the global position of the rightclick
    switch activePlane
      when PLANE_XY then position = [curGlobalPos[0] - (@curWidth/2 - position[0])/@x*zoomFactor, curGlobalPos[1] - (@curWidth/2 - position[1])/@x*zoomFactor, curGlobalPos[2]]
      when PLANE_YZ then position = [curGlobalPos[0], curGlobalPos[1] - (@curWidth/2 - position[1])/@x*zoomFactor, curGlobalPos[2] - (@curWidth/2 - position[0])/@x*zoomFactor]
      when PLANE_XZ then position = [curGlobalPos[0] - (@curWidth/2 - position[0])/@x*zoomFactor, curGlobalPos[1], curGlobalPos[2] - (@curWidth/2 - position[1])/@x*zoomFactor]
    unless @curIndex
      @curIndex = 0
    # Translating ThreeJS' coordinate system to the preview's one
    if @curIndex < @maxRouteLen
      @route.geometry.vertices[@curIndex] = new THREE.Vector3(position[0], Game.dataSet.upperBoundary[1] - position[2], position[1])
      @routeNodes.geometry.vertices[@curIndex] = new THREE.Vector3(position[0], Game.dataSet.upperBoundary[1] - position[2], position[1])
      for i in [0..2]
        ind = cam2d.getIndices i
        @routeView[i].geometry.vertices[@curIndex] = new THREE.Vector3(position[ind[0]], -position[ind[1]], -position[ind[2]])
        @routeView[i].geometry.verticesNeedUpdate = true
      @route.geometry.verticesNeedUpdate = true
      @routeNodes.geometry.verticesNeedUpdate = true
      
      #TEST CUBES
      #particle = new THREE.Mesh(new THREE.CubeGeometry(30, 30, 30, 1, 1, 1), new THREE.MeshBasicMaterial({color: 0xff0000}))
      #particle.position.x = position[0]
      #particle.position.y = Game.dataSet.upperBoundary[1] - position[2]
      #particle.position.z = position[1]
      #@addGeometry VIEW_3D, particle

      # Animation to center waypoint position
      @waypointAnimation = new TWEEN.Tween({ globalPosX: curGlobalPos[0], globalPosY: curGlobalPos[1], globalPosZ: curGlobalPos[2], cam2d: cam2d})
      @waypointAnimation.to({globalPosX: position[0], globalPosY: position[1], globalPosZ: position[2]}, 300)
      @waypointAnimation.onUpdate ->
        @cam2d.setGlobalPos [@globalPosX, @globalPosY, @globalPosZ]
        View.updateRoute()
      @waypointAnimation.start()
    
      @curIndex += 1
      cam2d.hasChanged = true

  onPreviewClick : (position) ->
    # vector with direction from camera position to click position
    vector = new THREE.Vector3((position[0] / 384 ) * 2 - 1, - (position[1] / 384) * 2 + 1, 0.5)
    
    # create a ray with the direction of this vector, set ray threshold depending on the zoom of the 3D-view
    projector = new THREE.Projector()
    ray = projector.pickingRay(vector, @camera[VIEW_3D])
    ray.setThreshold(@rayThreshold)

    # identify clicked object
    intersects = ray.intersectObjects([@routeNodes])

    console.log intersects[0].distance

    if (intersects.length > 0 and intersects[0].distance >= 0)
      intersects[0].object.material.color.setHex(Math.random() * 0xffffff)
      objPos = intersects[0].object.geometry.vertices[intersects[0].vertex]
      # jump to the nodes position
      cam2d.setGlobalPos [objPos.x, objPos.z, -objPos.y + Game.dataSet.upperBoundary[1]]

  createRoute : (maxRouteLen) ->
    # create route to show in previewBox and pre-allocate buffers
    @maxRouteLen = maxRouteLen
    routeGeometry = new THREE.Geometry()
    routeGeometryNodes = new THREE.Geometry()
    routeGeometry.dynamic = true
    routeGeometryNodes.dynamic = true
    routeGeometryView = new Array(3)
    for i in [0..2]
      routeGeometryView[i] = new THREE.Geometry()
      routeGeometryView[i].dynamic = true

    i = 0
    while i < maxRouteLen
      # workaround to hide the unused vertices
      routeGeometry.vertices.push(new THREE.Vector2(0,0))
      routeGeometryNodes.vertices.push(new THREE.Vector2(0,0))
      for g in routeGeometryView
        g.vertices.push(new THREE.Vector2(0, 0))
      i += 1

    route = new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({color: 0xff0000, linewidth: 1}))
    routeView = new Array(3)
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
      routeView[i] = new THREE.Line(routeGeometryView[i], new THREE.LineBasicMaterial({color: 0xff0000, linewidth: 1}))
    routeNodes = new THREE.ParticleSystem(routeGeometryNodes, new THREE.ParticleBasicMaterial({color: 0xff0000, size: 5, sizeAttenuation : false}))

    # Initializing Position
    gPos = cam2d.getGlobalPos()
    for i in [0..2]
      ind = cam2d.getIndices i
      routeView[i].position = new THREE.Vector3(-gPos[ind[0]], gPos[ind[1]], gPos[ind[2]])

    # set initial ray threshold to define initial click area
    @particles = []
    @rayThreshold = 100

    @addGeometry VIEW_3D, routeNodes
    @addGeometry VIEW_3D, route
    for i in [0..2]
      @addGeometry i, routeView[i]

    @route = route
    @routeView = routeView
    @routeNodes = routeNodes

  updateRoute : ->
    gPos                = cam2d.getGlobalPos()
    scale               = [cam2d.getPlaneScalingFactor(PLANE_XY), cam2d.getPlaneScalingFactor(PLANE_YZ), cam2d.getPlaneScalingFactor(PLANE_XZ)]
    
    for i in [0..2]
      ind = cam2d.getIndices i
      @routeView[i].scale    = new THREE.Vector3(1/scale[i], 1/scale[i], 1/scale[i])
      @routeView[i].position = new THREE.Vector3(-gPos[ind[0]]/scale[i], gPos[ind[1]]/scale[i], gPos[ind[2]]/scale[i]+1)
      @routeView[i].geometry.verticesNeedUpdate = true
