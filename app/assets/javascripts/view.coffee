### define
libs/flycam : Flycam
model : Model
###
    
# global View variables
cam = null

#constants
CAM_DISTANCE = 140

View =
  initialize : (canvas) ->

    # The "render" div serves as a container for the canvas, that is 
    # attached to it once a renderer has been initalized.
    container = $("#render")
    WIDTH = container.width()
    HEIGHT = container.height()

    # Initialize main THREE.js components
    @renderer = new THREE.WebGLRenderer({ clearColor: 0xffffff, antialias: true })
    @camera = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 10000)
    @scene = new THREE.Scene()

    # Let's set up a camera
    # The camera is never "moved". It only looks at the scene
    # (the trianglesplane in particular)
    @scene.add(@camera)
    @camera.position.z = CAM_DISTANCE
    @camera.lookAt(new THREE.Vector3( 0, 0, 0 ))

    # Attach the canvas to the container
    # DEBATE: a canvas can be passed the the renderer as an argument...!?
    @renderer.setSize(WIDTH, HEIGHT)
    container.append(@renderer.domElement)

    # This "camera" is not a camera in the traditional sense.
    # It rather hosts a number of matrix operations that 
    # calculate which pixel are visible on the trianglesplane
    # after moving around.
    cam = new Flycam CAM_DISTANCE

    #FPS stats
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

    @updateTrianglesplane()

    # update postion and FPS displays
    position = cam.getGlobalPos()
    @positionStats.html "#{position}<br />ZoomStep #{cam.getZoomStep()}<br />" 
    @stats.update()

    cam.hasChanged = false
    @renderer.render @scene, @camera

  # Let's apply new pixels to the trianglesplane.
  # We do so by apply a new texture to it.
  updateTrianglesplane : ->
      return unless @trianglesplane
      g = @trianglesplane

      transMatrix = cam.getMatrix()
      newVertices = M4x4.transformPointsAffine transMatrix, @trianglesplane.queryVertices

      globalMatrix = cam.getGlobalMatrix()
      #sends current position to Model for preloading data
      Model.Binary.ping transMatrix, cam.getZoomStep() #.done(View.draw).progress(View.draw)

      #sends current position to Model for caching route
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

  # Adds a new Three.js geometry to the scene.
  # This provides the public interface to the GeometryFactory.
  addGeometry : (geometry) ->
    @scene.add geometry

  #Apply a single draw (not used right now)
  draw : ->
    #FIXME: this is dirty
    cam.hasChanged = true

  setMatrix : (matrix) ->
    cam.setMatrix(matrix)

  getMatrix : ->
    cam.getMatrix()

  #Call this after the canvas was resized to fix the viewport
  resize : ->
    #FIXME: Is really the window's width or rather the DIV's?
    container = $("#render")
    WIDTH = container.width()
    HEIGHT = container.height()

    @renderer.setSize( WIDTH, HEIGHT )
    @camera.aspect  = WIDTH / HEIGHT
    @camera.updateProjectionMatrix()
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

  scaleTrianglesPlane : (delta) ->
    g = @trianglesplane
    if g 
      x = Number(g.scale.x) + Number(delta)
      if x > 0 and x < 2
        # why z? keep in mind the plane is rotated 90°
        g.scale.x = g.scale.z = x 
        cam.hasChanged = true

  zoomIn : ->
    if cam.getZoomStep() > 0
      cam.zoomIn()

  zoomOut : ->
    if cam.getZoomStep() < 3
        #todo: validation in Model
      cam.zoomOut()
