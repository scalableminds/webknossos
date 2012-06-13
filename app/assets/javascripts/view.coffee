### define
libs/flycam : Flycam
libs/flycam2 : Flycam2d
model : Model
###
    
# global View variables
cam = null
#cam2d = null

#constants
CAM_DISTANCE = 140

View =
  initialize : (canvas) ->

    # The "render" div serves as a container for the canvas, that is 
    # attached to it once a renderer has been initalized.
    container = $("#render")
    # Create a 4x4 grid
    WIDTH = container.width()/2
    HEIGHT = container.height()/2

    # Initialize main THREE.js components
    @rendererxy = new THREE.WebGLRenderer({ clearColor: 0xffffff, antialias: true })
    @cameraxy = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 10000)
    @scenexy = new THREE.Scene()

    @rendereryz = new THREE.WebGLRenderer({ clearColor: 0x0000ff, antialias: true })
    #@camerayz = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 10000)
    @camerayz = new THREE.OrthographicCamera( WIDTH / - 2, WIDTH / 2, HEIGHT / 2, HEIGHT / - 2, 1, 1000 );
    @sceneyz = new THREE.Scene()

    @rendererxz = new THREE.WebGLRenderer({ clearColor: 0x0000ff, antialias: true })
    @cameraxz = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 10000)
    @scenexz = new THREE.Scene()

    # Let's set up a camera
    # The camera is never "moved". It only looks at the scene
    # (the trianglesplane in particular)
    @scenexy.add(@cameraxy)
    @cameraxy.position.z = CAM_DISTANCE
    @cameraxy.lookAt(new THREE.Vector3( 0, 0, 0 ))

    @sceneyz.add(@camerayz)
    @camerayz.position.z = CAM_DISTANCE
    @camerayz.lookAt(new THREE.Vector3( 0, 0, 0 ))

    @scenexz.add(@cameraxz)
    @cameraxz.position.z = CAM_DISTANCE
    @cameraxz.lookAt(new THREE.Vector3( 0, 0, 0 ))

    # Attach the canvas to the container
    # DEBATE: a canvas can be passed the the renderer as an argument...!?
    @rendererxy.setSize(WIDTH, HEIGHT)
    @rendereryz.setSize(WIDTH, HEIGHT)
    @rendererxz.setSize(WIDTH, HEIGHT)
    container.append(@rendererxy.domElement)
    container.append(@rendereryz.domElement)
    container.append(@rendererxz.domElement)

    # This "camera" is not a camera in the traditional sense.
    # It rather hosts a number of matrix operations that 
    # calculate which pixel are visible on the trianglesplane
    # after moving around.
    cam = new Flycam CAM_DISTANCE
    #cam2d = new Flycam2d CAM_DISTANCE

    # FPS stats
    stats = new Stats()
    stats.getDomElement().style.position = 'absolute'
    stats.getDomElement().style.left = '0px'
    stats.getDomElement().style.top = '0px'
    $("body").append stats.getDomElement() 
    @stats = stats
    @positionStats = $("#status")

    # start the rendering loop
    @animate()

    # Dont forget to handle window resizing!
    $(window).resize( => @.resize() )

    # refresh the scene once a bucket is loaded
    # FIXME: probably not the most elgant thing to do
    $(window).on("bucketloaded", => cam.hasChanged = true) 

  animate : ->
    @renderFunction()

    window.requestAnimationFrame => @animate()

  # This is the main render function.
  # All 3D meshes and the trianglesplane are rendered here.
  renderFunction : ->

    # skip rendering if nothing has changed
    # This prevents you the GPU/CPU from constantly
    # working and keeps your lap cool
    # ATTENTION: this limits the FPS to 30 FPS (depending on the keypress update frequence)
    if cam.hasChanged is false
      return
    #if cam2d.hasChanged is false
    #  return

    @updateTrianglesplane()

    # update postion and FPS displays
    position = cam.getGlobalPos()
    position2d = [1,2,3]# cam2d.getGlobalPos()
    @positionStats.html "#{position}<br />#{position2d}<br />ZoomStep #{cam.getZoomStep()}<br />" 
    @stats.update()

    cam.hasChanged = false
    #cam2d.hasChanged = false
    @rendererxy.render @scenexy, @cameraxy
    @rendereryz.render @sceneyz, @camerayz
    @rendererxz.render @scenexz, @cameraxz

  # Let's apply new pixels to the trianglesplane.
  # We do so by apply a new texture to it.
  updateTrianglesplane : ->
      # use old trianglesplane for xy
      return unless @trianglesplane
      g = @trianglesplane

      # new trianglesplane for yz
      return unless @trianglesplaneyz
      gyz = @trianglesplaneyz

      transMatrix = cam.getMatrix()
      newVertices = M4x4.transformPointsAffine transMatrix, @trianglesplane.queryVertices

      globalMatrix = cam.getGlobalMatrix()
      # sends current position to Model for preloading data
      Model.Binary.ping transMatrix, cam.getZoomStep() #.done(View.draw).progress(View.draw)

      # sends current position to Model for caching route
      Model.Route.put globalMatrix

      # trilinear interpolation
      # we used to do this on the shader (trianglesplane.vs)
      # but we switched to this software method in order to use texture on the 
      # trianglesplane
      # This is likely to change in the future, if we manage to do the selection,
      # of the corresponding vertices on the GPU
      Model.Binary.get(newVertices, cam.getZoomStep()).done (buffer) ->
          
        # ATTENTION 
        # when playing around with texture please look at setTexture() (line 5752 in WebGLRenderer)
        # the data attribute is only available for DataTexture (in other cases it is only texture.image)
        g.texture.image.data.set(buffer)

        # Update the texture data and make sure the new texture
        # is used by the Mesh's material.
        g.texture.needsUpdate = true
        g.material.map = g.texture

      # TODO implement interface to get new textures, for now just use the old buffer
      #Model.Binary.getxy(cam.getGlobalPos(), cam.getZoomStepxy()).done (bufferxy) ->
        gyz.texture.image.data.set(buffer)
        gyz.texture.needsUpdate = true
        gyz.material.map = gyz.texture

  # Adds a new Three.js geometry to the scene.
  # This provides the public interface to the GeometryFactory.
  addGeometryxy : (geometry) ->
    @scenexy.add geometry

  addGeometryyz : (geometry) ->
    @sceneyz.add geometry

  #Apply a single draw (not used right now)
  draw : ->
    #FIXME: this is dirty
    cam.hasChanged = true
    #cam2d.hasChanged = true

  setMatrix : (matrix) ->
    cam.setMatrix(matrix)

  getMatrix : ->
    cam.getMatrix()

  #Call this after the canvas was resized to fix the viewport
  resize : ->
    #FIXME: Is really the window's width or rather the DIV's?
    container = $("#render")
    WIDTH = container.width()/2
    HEIGHT = container.height()/2

    @rendererxy.setSize( WIDTH, HEIGHT )
    @rendereryz.setSize( WIDTH, HEIGHT )
    @rendererxz.setSize( WIDTH, HEIGHT )
    @cameraxy.aspect  = WIDTH / HEIGHT
    @cameraxy.updateProjectionMatrix()
    @camerayz.aspect  = WIDTH / HEIGHT
    @camerayz.updateProjectionMatrix()
    @cameraxz.aspect  = WIDTH / HEIGHT
    @cameraxz.updateProjectionMatrix()
    @draw()

############################################################################
#Interface for Controller
  yaw : (angle) ->
    cam.yaw angle

  yawDistance : (angle) ->
    cam.yawDistance angle

  roll : (angle) ->
    cam.roll angle

  rollDistance : (angle) ->
    cam.rollDistance angle

  pitch : (angle) ->
    cam.pitch angle

  pitchDistance : (angle) ->
    cam.pitchDistance angle

  move : (p) ->
    cam.move p
    #cam2d.move p

  scaleTrianglesPlane : (delta) ->
    g = @trianglesplane
    if g 
      x = Number(g.scale.x) + Number(delta)
      if x > 0 and x < 2
        # why z? keep in mind the plane is rotated 90°
        g.scale.x = g.scale.z = x 
        cam.hasChanged = true
        #cam2d.hasChanged = true

  zoomIn : ->
    if cam.getZoomStep() > 0
      cam.zoomIn()

  zoomOut : ->
    if cam.getZoomStep() < 3
        #todo: validation in Model
      cam.zoomOut()
