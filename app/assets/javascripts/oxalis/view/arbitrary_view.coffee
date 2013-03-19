### define
libs/event_mixin : EventMixin
three : THREE
stats : Stats
jquery : $
underscore : _
../constants : constants
###

class ArbitraryView

  CAM_DISTANCE   : 64
  DEFAULT_SCALE  : 2
  MAX_SCALE      : 3
  MIN_SCALE      : 1

  forceUpdate : false
  geometries : []
  additionalInfo : ""

  isRunning : true

  scene : null
  camera : null
  cameraPosition : null

  constructor : (canvas, @dataCam, @stats, @renderer, @scene) ->

    _.extend(this, new EventMixin())

    # The "render" div serves as a container for the canvas, that is 
    # attached to it once a renderer has been initalized.
    @container = $(canvas)
    @width  = @container.width()
    @height = @container.height()

    # Initialize main THREE.js components

    @camera = camera = new THREE.PerspectiveCamera(90, @width / @height, 50, 1000)
    camera.matrixAutoUpdate = false
    camera.aspect = @width / @height
  
    @cameraPosition = new THREE.Vector3(0, 0, @CAM_DISTANCE)

    @group = new THREE.Object3D
    # The dimension(s) with the highest resolution will not be distorted
    @group.scale = new THREE.Vector3(12, 12, 24)
    # Add scene to the group, all Geometries are than added to group
    @scene.add(@group)
    @group.add(camera)


  start : ->

    unless @isRunning
      @isRunning = true

      for element in @group.children
        element.visible = true
      $("#arbitrary-info-canvas").show()

      #render hack to avoid flickering
      @renderer.setSize(384, 384)
      @resize()
      # start the rendering loop
      @animate()
      # Dont forget to handle window resizing!
      $(window).on "resize", @resize
      @resize()


  stop : ->

    if @isRunning
      @isRunning = false

      for element in @group.children
        element.visible = false
      $("#arbitrary-info-canvas").hide()

      $(window).off "resize", @resize


  animate : ->

    return unless @isRunning

    if @trigger("render", @forceUpdate) or @forceUpdate

      { camera, stats, geometries, renderer, scene } = @

      # update postion and FPS displays
      stats.update()

      for geometry in geometries when geometry.update?
        geometry.update()

      m = @dataCam.getZoomedMatrix()
       
      camera.matrix.set m[0], m[4], m[8],  m[12], 
                        m[1], m[5], m[9],  m[13], 
                        m[2], m[6], m[10], m[14], 
                        m[3], m[7], m[11], m[15]

      camera.matrix.rotateY(Math.PI)
      camera.matrix.translate(@cameraPosition)
      camera.matrixWorldNeedsUpdate = true

      renderer.setViewport(0, 0, @width, @height)
      renderer.setScissor(0, 0, @width, @height)
      renderer.enableScissorTest(true)
      renderer.setClearColorHex(0xFFFFFF, 1);

      renderer.render scene, camera

      forceUpdate = false

    window.requestAnimationFrame => @animate()
   

  draw : -> 

    @forceUpdate = true


  # Adds a new Three.js geometry to the scene.
  # This provides the public interface to the GeometryFactory.
  addGeometry : (geometry) -> 

    @geometries.push(geometry)
    geometry.attachScene(@group)
    return


  # Call this after the canvas was resized to fix the viewport
  # Needs to be bound
  resize : =>

    @width  = @container.width()
    @height = @container.height()

    @camera.aspect = @width / @height
    @camera.updateProjectionMatrix()
    @draw()


  applyScale : (delta) =>

    @scaleFactor = @DEFAULT_SCALE unless @scaleFactor
    if (@scaleFactor+delta > @MIN_SCALE) and (@scaleFactor+delta < @MAX_SCALE)
      @scaleFactor += Number(delta)
      @width = @height = @scaleFactor * constants.WIDTH
      @container.width(@width)
      @container.height(@height)

      @resize()

  setRouteClippingDistance : (value) =>

    @camera.near = @CAM_DISTANCE - value
    @camera.updateProjectionMatrix()


  setAdditionalInfo : (info) ->

    @additionalInfo = info

