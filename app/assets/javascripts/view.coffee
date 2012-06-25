### define
libs/flycam : Flycam
libs/flycam2 : Flycam2d
model : Model
###
    
# global View variables
cam2d = null

# constants
# display 384px out of 512px total width and height
CAM_DISTANCE = 96
PLANE_XY = 0
PLANE_YZ = 1
PLANE_XZ = 2

View =
  initialize : ->

    # The "render" div serves as a container for the canvas, that is 
    # attached to it once a renderer has been initalized.
    container = $("#render")
    # Create a 4x4 grid
    WIDTH = (container.width()-40)/2
    HEIGHT = (container.height()-40)/2

    # Initialize main THREE.js components
    @rendererxy = new THREE.WebGLRenderer({ clearColor: 0xffffff, antialias: true })
    @cameraxy = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 1, 1000)
    @scenexy = new THREE.Scene()

    @rendereryz = new THREE.WebGLRenderer({ clearColor: 0x0000ff, antialias: true })
    @camerayz = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 10000)
    @sceneyz = new THREE.Scene()

    @rendererxz = new THREE.WebGLRenderer({ clearColor: 0x0000ff, antialias: true })
    @cameraxz = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 10000)
    @scenexz = new THREE.Scene()

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
    cam2d = new Flycam2d CAM_DISTANCE

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
    $(window).on("bucketloaded", => cam2d.hasChanged = true) 

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
    if cam2d.hasChanged is false
      return

    @updateTrianglesplane()

    # update postion and FPS displays
    position2d = cam2d.getGlobalPos()
    @positionStats.html "Flycam2d: #{position2d}<br />ZoomStep #{cam2d.getZoomStep(0)}<br />activePlane: #{cam2d.getActivePlane()}" 
    @stats.update()

    cam2d.hasChanged = false
    @rendererxy.render @scenexy, @cameraxy
    @rendereryz.render @sceneyz, @camerayz
    @rendererxz.render @scenexz, @cameraxz

  # Let's apply new pixels to the trianglesplane.
  # We do so by apply a new texture to it.
  updateTrianglesplane : ->
      # new trianglesplane for xy
      return unless @trianglesplanexy
      gxy = @trianglesplanexy

      # new trianglesplane for yz
      return unless @trianglesplaneyz
      gyz = @trianglesplaneyz

      # new trianglesplane for xz
      return unless @trianglesplanexz
      gxz = @trianglesplanexz

      # sends current position to Model for preloading data
      # NEW with direction vector
      # Model.Binary.ping cam2d.getGlobalPos(), cam2d.getDirection(), cam2d.getZoomStep(PLANE_XY)
      Model.Binary.ping cam2d.getGlobalPos(), cam2d.getZoomStep(PLANE_XY)

      # sends current position to Model for caching route
      # TODO implement Routing Model.Route.put globalMatrix

      # trilinear interpolation
      # we used to do this on the shader (trianglesplane.vs)
      # but we switched to this software method in order to use texture on the 
      # trianglesplane
      # This is likely to change in the future, if we manage to do the selection,
      # of the corresponding vertices on the GPU
      Model.Binary.getXY(cam2d.getGlobalPos(), cam2d.getZoomStep(PLANE_XY)).done (bufferxy) ->
          
        # ATTENTION 
        # when playing around with texture please look at setTexture() (line 5752 in WebGLRenderer)
        # the data attribute is only available for DataTexture (in other cases it is only texture.image)
        gxy.texture.image.data.set(bufferxy)

        # Update the texture data and make sure the new texture
        # is used by the Mesh's material.
        gxy.texture.needsUpdate = true
        gxy.material.map = gxy.texture

      # TODO implement other two interfaces to get new textures, for now just use the old buffer
      #Model.Binary.getyz(cam2d.getGlobalPos(), cam2d.getZoomStep(PLANE_YZ)).done (bufferyz) ->
        gyz.texture.image.data.set(bufferxy)
        gyz.texture.needsUpdate = true
        gyz.material.map = gyz.texture

      #Model.Binary.getyz(cam2d.getGlobalPos(), cam2d.getZoomStep(PLANE_XZ)).done (bufferxz) ->
        gxz.texture.image.data.set(bufferxy)
        gxz.texture.needsUpdate = true
        gxz.material.map = gxz.texture

  # Adds a new Three.js geometry to the scene.
  # This provides the public interface to the GeometryFactory.
  addGeometryXY : (geometry) ->
    @scenexy.add geometry

  addGeometryYZ : (geometry) ->
    @sceneyz.add geometry

  addGeometryXZ : (geometry) ->
    @scenexz.add geometry

  #Apply a single draw (not used right now)
  draw : ->
    #FIXME: this is dirty
    cam2d.hasChanged = true

  setMatrix : (matrix) ->
    cam2d.setGlobalPos([matrix[12], matrix[13], matrix[14]])

  setGlobalPos : (pos) ->
    cam2d.setGlobalPos(pos)

  # probably obsolete
  getMatrix : ->
    cam2d.getGlobalPos()

  #Call this after the canvas was resized to fix the viewport
  resize : ->
    #FIXME: Is really the window's width or rather the DIV's?
    container = $("#render")
    WIDTH = (container.width()-40)/2
    HEIGHT = (container.height()-40)/2

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
  # TODO: Some of those are probably obsolete

  setDirection : (direction) ->
    cam2d.setDirection direction

  move : (p) ->
    cam2d.move p

  moveActivePlane : (p) ->
    switch (cam2d.getActivePlane())
      when PLANE_XY
        cam2d.move p
      when PLANE_YZ
        cam2d.move [p[2], p[1], p[0]]
      when PLANE_XZ
        cam2d.move [p[0], p[2], p[1]]

  #FIXME: why do values have to be multiplied?
  #FIXME: why can't I call move() from within this function?
  moveX : (x) -> 
    cam2d.move [100*x, 0, 0]

  moveY : (y) ->
    cam2d.move [0, 100*y, 0]
  
  moveZ : (z) ->
    cam2d.move [0, 0, 100*z]

  scaleTrianglesPlane : (delta) ->
    g = @trianglesplanexy
    if g 
      x = Number(g.scale.x) + Number(delta)
      if x > 0 and x < 2
        # why z? keep in mind the plane is rotated 90°
        g.scale.x = g.scale.z = x 
        cam2d.hasChanged = true

  zoomIn : ->
    if cam2d.getZoomStep(cam2d.getActivePlane()) > 0
      cam2d.zoomIn(cam2d.getActivePlane())

  #todo: validation in Model
  zoomOut : ->
    if cam2d.getZoomStep(cam2d.getActivePlane()) < 3
      cam2d.zoomOut(cam2d.getActivePlane())

  setActivePlane : (activePlane) ->
    cam2d.setActivePlane activePlane
    cam2d.hasChanged = true

  setActivePlaneXY : ->
    cam2d.setActivePlane PLANE_XY
    cam2d.hasChanged = true

  setActivePlaneYZ : ->
    cam2d.setActivePlane PLANE_YZ
    cam2d.hasChanged = true

  setActivePlaneXZ : ->
    cam2d.setActivePlane PLANE_XZ
    cam2d.hasChanged = true
