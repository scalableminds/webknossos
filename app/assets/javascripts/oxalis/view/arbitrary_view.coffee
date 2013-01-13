### define
libs/event_mixin : EventMixin
three : THREE
stats : Stats
jquery : $
underscore : _
###

CAM_DISTANCE = 140

class ArbitraryView

  forceUpdate : false
  geometries : []
  additionalInfo : ""

  isRunning : false

  scene : null
  camera : null
  cameraPosition : null

  constructor : (canvas, @dataCam) ->

    _.extend(this, new EventMixin())

    # The "render" div serves as a container for the canvas, that is 
    # attached to it once a renderer has been initalized.
    @container = $(canvas)
    width  = @container.width()
    height = @container.height()

    # Initialize main THREE.js components
    @renderer = new THREE.WebGLRenderer( clearColor: 0x000000, antialias: false )

    @camera = camera = new THREE.PerspectiveCamera(90, width / height, 0.1, 1000)
    #camera.matrixAutoUpdate = false
    camera.aspect = width / height
  
    @scene = scene = new THREE.Scene()  
    @camera.position.z = -CAM_DISTANCE
    @camera.lookAt(new THREE.Vector3( 0, 0, 0 ))
    scene.add(camera)

    # Attach the canvas to the container
    # DEBATE: a canvas can be passed the the renderer as an argument...!?
    @renderer.setSize(width, height)
    #@renderer.sortObjects = false
    @container.append(@renderer.domElement)

    #FPS stats
    @stats = new Stats()
    statsDomElement = @stats.getDomElement()
    statsDomElement.id = "fps-stats"
    $("body").append(statsDomElement)

    @start()


  start : ->

    unless @isRunning
      @isRunning = true
      # start the rendering loop
      @animate()
      # Dont forget to handle window resizing!
      $(window).on "resize", @resize


  stop : ->

    if @isRunning
      @isRunning = false
      $(window).off "resize", @resize


  animate : ->

    return unless @isRunning

    if @trigger("render", @forceUpdate) or 1 #@forceUpdate

      { camera, stats, geometries, renderer, scene } = @

      # update postion and FPS displays
      stats.update()

      for geometry in geometries when geometry.update?
        geometry.update()

      #m = @dataCam.getMatrix()
 
      #camera.matrix.set m[0], m[4], m[8],  m[12], 
      #                  m[1], m[5], m[9],  m[13], 
      #                  m[2], m[6], m[10], m[14], 
      #                  m[3], m[7], m[11], m[15]


      #camera.matrix.translate(@cameraPosition)  
      #camera.matrix.rotateY(Math.PI)
      ##camera.matrix.rotateX(-0.7)

      #camera.matrixWorldNeedsUpdate = true

      renderer.render scene, camera

      forceUpdate = false

    window.requestAnimationFrame => @animate()
   

  draw : -> @forceUpdate = true

  # Adds a new Three.js geometry to the scene.
  # This provides the public interface to the GeometryFactory.
  addGeometry : (geometry) -> 

    @geometries.push(geometry)
    geometry.attachScene(@scene)
    return


  # Call this after the canvas was resized to fix the viewport
  # Needs to be bound
  resize : =>
    
    width  = @container.width()
    height = @container.height()

    @renderer.setSize( width, height )
    @camera.aspect = width / height
    @camera.updateProjectionMatrix()
    @draw()


  setAdditionalInfo : (info) ->
    @additionalInfo = info

