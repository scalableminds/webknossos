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
    WIDTH = container.width()/2
    HEIGHT = container.height()/2

    # Initialize main THREE.js components
    @renderer = new THREE.WebGLRenderer({ clearColor: 0xffffff, antialias: true })
    @camera = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 10000)
    @scene = new THREE.Scene()

    @rendereryz = new THREE.WebGLRenderer({ clearColor: 0xff0000, antialias: true })
    @camerayz = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 10000)
    @sceneyz = new THREE.Scene()

    @rendererxz = new THREE.WebGLRenderer({ clearColor: 0xff0000, antialias: true })
    @cameraxz = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 10000)
    @scenexz = new THREE.Scene()

    #experimental sphere
    sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xccff00 })
    sphereyz = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 16), sphereMaterial)

    sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xcc0000 })
    spherexz = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 16), sphereMaterial)

    # Let's set up a camera
    # The camera is never "moved". It only looks at the scene
    # (the trianglesplane in particular)
    @scene.add(@camera)
    @camera.position.z = CAM_DISTANCE
    @camera.lookAt(new THREE.Vector3( 0, 0, 0 ))

    @sceneyz.add(@camerayz)
    @sceneyz.add(sphereyz)
    @camerayz.position.z = CAM_DISTANCE
    @camerayz.lookAt(new THREE.Vector3( 0, 0, 0 ))

    @scenexz.add(@cameraxz)
    @scenexz.add(spherexz)
    @cameraxz.position.z = CAM_DISTANCE
    @cameraxz.lookAt(new THREE.Vector3( 0, 0, 0 ))

    # Attach the canvas to the container
    # DEBATE: a canvas can be passed the the renderer as an argument...!?
    @renderer.setSize(WIDTH, HEIGHT)
    @rendereryz.setSize(WIDTH, HEIGHT)
    @rendererxz.setSize(WIDTH, HEIGHT)
    container.append(@renderer.domElement)
    container.append(@rendereryz.domElement)
    container.append(@rendererxz.domElement)

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
    @rendereryz.render @sceneyz, @camerayz
    @rendererxz.render @scenexz, @cameraxz

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
      Model.Binary.get(newVertices, cam.getZoomStep()).done ({ buffer0, buffer1, bufferDelta }) ->
          
        # ATTENTION 
        # when playing around with texture please look at setTexture() (line 5752 in WebGLRenderer)
        # the data attribute is only available for DataTexture (in other cases it is only texture.image)
        textureData = g.texture.image.data

        i = j = 0
        k = 1 << 14 # 128 * 128
        while --k

          index0 = j++
          index1 = j++
          index2 = j++
          index3 = j++

          bufferDelta0 = bufferDelta[i++]
          bufferDelta1 = bufferDelta[i++]
          bufferDelta2 = bufferDelta[i++]

          diff0 = 1.0 - bufferDelta0
          diff1 = 1.0 - bufferDelta1
          diff2 = 1.0 - bufferDelta2

          colorScalar =      
              buffer0[index0] * diff0         * diff1         * diff2 +
              buffer0[index1] * bufferDelta0  * diff1         * diff2 + 
              buffer0[index2] * diff0         * bufferDelta1  * diff2 + 
              buffer0[index3] * bufferDelta0  * bufferDelta1  * diff2 +
              buffer1[index0] * diff0         * diff1         * bufferDelta2 + 
              buffer1[index1] * bufferDelta0  * diff1         * bufferDelta2 + 
              buffer1[index2] * diff0         * bufferDelta1  * bufferDelta2 + 
              buffer1[index3] * bufferDelta0  * bufferDelta1  * bufferDelta2

          textureData[k] = colorScalar

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
