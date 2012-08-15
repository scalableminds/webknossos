### define
libs/flycam : Flycam
libs/flycam2 : Flycam2d
libs/Tween : TWEEN_LIB
model/game : Game
libs/event_mixin : EventMixin
###

#model : Model
    
# global View variables
# flycam = null

# constants
# display 512px out of 512px total width and height
#CAM_DISTANCE = 384/2 # alt: 384/2  #alt: 96
VIEWPORT_WIDTH = 380
PLANE_XY = 0
PLANE_YZ = 1
PLANE_XZ = 2
VIEW_3D  = 3

class View

  constructor : (model, flycam) ->

    _.extend(this, new EventMixin())

    @model  = model
    @flycam = flycam

    # The "render" div serves as a container for the canvas, that is 
    # attached to it once a renderer has been initalized.
    container = $("#render")
    # Create a 4x4 grid
    @curWidth = WIDTH = (container.width()-20)/2
    HEIGHT = (container.height()-20)/2
    @x = 1

    @geometries = []

    # Initialize main THREE.js components
    # Max. distance the route may have from the main plane in order to be displayed:
    @camDistance = 40
    colors    = [0xff0000, 0x0000ff, 0x00ff00, 0xffffff]
    @renderer = new THREE.WebGLRenderer({clearColor: colors[i], clearAlpha: 1, antialias: false})
    @camera   = new Array(4)
    @scene    = new THREE.Scene()
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ, VIEW_3D]
      camDistance  = if i==VIEW_3D then 100000 else @camDistance
      boundary     = if i==VIEW_3D then 300    else VIEWPORT_WIDTH/2
      @camera[i]   = new THREE.OrthographicCamera(-boundary-2, boundary+2, boundary+2, -boundary-2, -camDistance, camDistance)

      # Let's set up cameras
      # The cameras are never "moved". They only look at the scene
      # (the trianglesplanes in particular)
      @scene.add @camera[i]
    @camera[PLANE_XY].position.z = -1
    @camera[PLANE_YZ].position.x =  1
    @camera[PLANE_XZ].position.y =  1
    @camera[VIEW_3D].position    = new THREE.Vector3(10, 10, -10)
    @camera[PLANE_XY].up         = new THREE.Vector3( 0, -1,  0)
    @camera[PLANE_YZ].up         = new THREE.Vector3( 0, -1,  0)
    @camera[PLANE_XZ].up         = new THREE.Vector3( 0,  0, -1)
    @camera[VIEW_3D].up          = new THREE.Vector3( 0,  0, -1)
    for cam in @camera
      cam.lookAt(new THREE.Vector3( 0, 0, 0))

    # Attach the canvas to the container
    @renderer.setSize 2*WIDTH+20, 2*HEIGHT+20
    container.append @renderer.domElement

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
    # $(window).on("bucketloaded", => @flycam.hasChanged = true; @flycam.newBuckets = [true, true, true]) 

  animate : ->

    @renderFunction()

    window.requestAnimationFrame => @animate()

  # This is the main render function.
  # All 3D meshes and the trianglesplane are rendered here.
  renderFunction : ->

    @trigger "render"

    TWEEN.update()

    # skip rendering if nothing has changed
    # This prevents you the GPU/CPU from constantly
    # working and keeps your lap cool
    # ATTENTION: this limits the FPS to 30 FPS (depending on the keypress update frequence)
    
    # update postion and FPS displays
    position2d = @flycam.getGlobalPos()
    texturePositionXY = @flycam.texturePosition[0]
    # without rounding the position becomes really long and blocks the canvas mouse input
    position2d = [Math.round(position2d[0]),Math.round(position2d[1]),Math.round(position2d[2])]
    texturePositionXY = [Math.round(texturePositionXY[0]),Math.round(texturePositionXY[1]),Math.round(texturePositionXY[2])]
    @positionStats.html "Flyflycam: #{position2d}<br />texturePositionXY: #{texturePositionXY}<br />ZoomStep #{@flycam.getIntegerZoomStep(@flycam.getActivePlane())}<br />activePlane: #{@flycam.getActivePlane()}" 
    @stats.update()

    @newTextures[VIEW_3D] = @newTextures[0] or @newTextures[1] or @newTextures[2]
    viewport = [[0, @curWidth+20], [@curWidth+20, @curWidth+20], [0, 0], [@curWidth+20, 0]]
    @renderer.autoClear = true
    colors   = [ 0xff0000, 0x00ff00, 0x0000ff, 0xffffff]
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ, VIEW_3D]
      @trigger "renderCam", i
    #  if @flycam.hasChanged or @newTextures[i]
      @renderer.setViewport(viewport[i][0], viewport[i][1], @curWidth, @curWidth)
      @renderer.setScissor(viewport[i][0], viewport[i][1], @curWidth, @curWidth)
      @renderer.enableScissorTest(true)
      @renderer.setClearColorHex(colors[i], 0.5);
      @renderer.render @scene, @camera[i]
    @flycam.hasChanged = false
    @newTextures = [false, false, false, false]
  
  # Adds a new Three.js geometry to the scene.
  # This provides the public interface to the GeometryFactory.
  addGeometry : (planeID, geometry) ->
    @scene.add geometry

  #Apply a single draw (not used right now)
  draw : ->
    #FIXME: this is dirty
    @flycam.hasChanged = true

  #Call this after the canvas was resized to fix the viewport
  resize : ->
    #FIXME: Is really the window's width or rather the DIV's?
    container = $("#render")
    WIDTH = (container.width()-20)/2
    HEIGHT = (container.height()-20)/2

    @renderer.setSize( 2*WIDTH+20, 2*HEIGHT+20)
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ, VIEW_3D]
      @camera[i].aspect = WIDTH / HEIGHT
      @camera[i].updateProjectionMatrix()
    @draw()
  
  scaleTrianglesPlane : (delta) =>
    @x = 1 unless @x
    if (@x+delta > 0.75) and (@x+delta < 1.5)
      @x += Number(delta)
      @curWidth = WIDTH = HEIGHT = @x * 384
      container = $("#render")
      container.width(2 * WIDTH + 48)
      container.height(2 * HEIGHT + 48)

      # scales the 3D-view controls
      prevControl = $("#prevControls")
      prevControl.css({top: @x * 440 + "px", left: @x * 420 + "px"})

      @resize()

  zoomIn : =>
    if @model.User.Configuration.lockZoom
      @flycam.zoomInAll()
    else 
      @flycam.zoomIn(flycam.getActivePlane())
    @updateCamDistance()

  zoomOut : =>
    if @model.User.Configuration.lockZoom
      @flycam.zoomOutAll()
    else 
      @flycam.zoomOut(flycam.getActivePlane())
    @updateCamDistance()

  updateCamDistance : ->
    for i in [0..2]
      @camera[i].near = - @camDistance/@flycam.getPlaneScalingFactor(i)
      @camera[i].updateProjectionMatrix()
    @flycam.hasChanged = true

  setRouteClippingDistance : (value) ->
    @camDistance = value
    @updateCamDistance()

  setActivePlaneXY : =>
    @setActivePlane PLANE_XY

  setActivePlaneYZ : =>
    @setActivePlane PLANE_YZ

  setActivePlaneXZ : =>
    @setActivePlane PLANE_XZ

  setActivePlane : (planeID) =>
    @flycam.setActivePlane planeID
    for i in [0..2]
      catcherStyle = $(".inputcatcher")[i].style
      #catcherStyle.borderColor  = "#f8f800"   #  else "#C7D1D8"
      $(".inputcatcher")[i].style.borderWidth = if i==planeID then "2px" else "0px"

  # updateRoute : =>
  #   gPos                = @flycam.getGlobalPos()
  #   scale               = [@flycam.getPlaneScalingFactor(PLANE_XY), @flycam.getPlaneScalingFactor(PLANE_YZ), @flycam.getPlaneScalingFactor(PLANE_XZ)]
    
  #   for i in [0..2]
  #     ind = @flycam.getIndices i
  #     @routeView[i].scale    = new THREE.Vector3(1/scale[i], 1/scale[i], 1/scale[i])
  #     @routeView[i].position = new THREE.Vector3(-gPos[ind[0]]/scale[i], gPos[ind[1]]/scale[i], gPos[ind[2]]/scale[i]+1)
  #     @routeView[i].geometry.verticesNeedUpdate = true

  getCameras : =>
    @camera