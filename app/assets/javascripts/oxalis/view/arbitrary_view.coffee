### define
libs/event_mixin : EventMixin
three : THREE
stats : Stats
jquery : $
underscore : _
../constants : constants
###

class ArbitraryView

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

  constructor : (canvas, @dataCam, @stats, @view, scaleInfo, width) ->

    _.extend(this, new EventMixin())

    # CAM_DISTANCE has to be calculates such that with cam
    # angle 45°, the plane of width 128 fits exactly in the
    # viewport.
    @CAM_DISTANCE = width / 2 / Math.tan( Math.PI / 180 * 45 / 2 )

    # The "render" div serves as a container for the canvas, that is
    # attached to it once a renderer has been initalized.
    @container = $(canvas)
    @width  = @container.width()
    @height = @container.height()
    @deviceScaleFactor = window.devicePixelRatio || 1

    { @renderer, @scene } = @view

    # Initialize main THREE.js components

    @camera = camera = new THREE.PerspectiveCamera(45, @width / @height, 50, 1000)
    camera.matrixAutoUpdate = false
    camera.aspect = @width / @height

    @cameraPosition = [0, 0, @CAM_DISTANCE]

    @group = new THREE.Object3D
    # The dimension(s) with the highest resolution will not be distorted
    @group.scale = new THREE.Vector3(scaleInfo.nmPerVoxel...)
    # Add scene to the group, all Geometries are than added to group
    @scene.add(@group)
    @group.add(camera)


  start : ->

    unless @isRunning
      @isRunning = true

      for element in @group.children
        element.setVisibility = element.setVisibility || (v) -> this.visible = v
        element.setVisibility true

      $("#arbitrary-info-canvas").show()

      @resize()
      # start the rendering loop
      @animate()
      # Dont forget to handle window resizing!
      $(window).on "resize", @resize


  stop : ->

    if @isRunning
      @isRunning = false

      for element in @group.children
        element.setVisibility = element.setVisibility || (v) -> this.visible = v
        element.setVisibility false

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

      camera.matrix.multiply( new THREE.Matrix4().makeRotationY( Math.PI ))
      camera.matrix.multiply( new THREE.Matrix4().makeTranslation( @cameraPosition... ))
      camera.matrixWorldNeedsUpdate = true

      f = @deviceScaleFactor
      renderer.setViewport(0, 0, @width * f, @height * f)
      renderer.setScissor(0, 0, @width * f, @height * f)
      renderer.enableScissorTest(true)
      renderer.setClearColor(0xFFFFFF, 1);

      renderer.render scene, camera

      forceUpdate = false

      @trigger("finishedRender")

    window.requestAnimationFrame => @animate()


  draw : ->

    @forceUpdate = true


  addGeometry : (geometry) ->
    # Adds a new Three.js geometry to the scene.
    # This provides the public interface to the GeometryFactory.

    @geometries.push(geometry)
    geometry.attachScene(@group)
    return


  resizeThrottled : ->
    # throttle resize to avoid annoying flickering

    @resizeThrottled = _.throttle(
      => @resize()
      constants.RESIZE_THROTTLE_TIME
    )
    @resizeThrottled()


  resize : =>
    # Call this after the canvas was resized to fix the viewport
    # Needs to be bound

    @width  = @container.width()
    @height = @container.height()

    @renderer.setSize(@width, @height)

    @camera.aspect = @width / @height
    @camera.updateProjectionMatrix()
    @draw()


  applyScale : (delta) =>

    @scaleFactor = @DEFAULT_SCALE unless @scaleFactor

    if (@scaleFactor+delta > @MIN_SCALE) and (@scaleFactor+delta < @MAX_SCALE)
      @scaleFactor += Number(delta)
      @width = @height = @scaleFactor * constants.VIEWPORT_WIDTH
      @container.width(@width)
      @container.height(@height)

      @resizeThrottled()

  setClippingDistance : (value) =>

    @camera.near = @CAM_DISTANCE - value
    @camera.updateProjectionMatrix()


  setAdditionalInfo : (info) ->

    @additionalInfo = info

