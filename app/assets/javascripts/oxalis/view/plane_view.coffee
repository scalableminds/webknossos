app        = require("app")
Backbone   = require("backbone")
$          = require("jquery")
TWEEN      = require("tween.js")
Dimensions = require("../model/dimensions")
Toast      = require("../../libs/toast")
constants  = require("../constants")
modal      = require("./modal")
THREE      = require("three")

class PlaneView

  constructor : (@model, @view) ->

    _.extend(this, Backbone.Events)

    { @renderer, @scene } = @view
    @running = false

    # The "render" div serves as a container for the canvas, that is
    # attached to it once a renderer has been initalized.
    container = $("#render")

    # Create a 4x4 grid
    @curWidth = WIDTH = HEIGHT = constants.VIEWPORT_WIDTH
    @scaleFactor = 1
    @deviceScaleFactor = window.devicePixelRatio || 1

    # Initialize main THREE.js components
    @camera   = new Array(4)
    @lights   = new Array(3)

    for i in constants.ALL_VIEWPORTS
      # Let's set up cameras
      # No need to set any properties, because the camera controller will deal with that
      @camera[i]   = new THREE.OrthographicCamera(0, 0, 0, 0)
      @scene.add @camera[i]

    @camera[constants.PLANE_XY].position.z = -1
    @camera[constants.PLANE_YZ].position.x =  1
    @camera[constants.PLANE_XZ].position.y =  1
    @camera[constants.TDView].position    = new THREE.Vector3(10, 10, -10)
    @camera[constants.PLANE_XY].up        = new THREE.Vector3( 0, -1,  0)
    @camera[constants.PLANE_YZ].up        = new THREE.Vector3( 0, -1,  0)
    @camera[constants.PLANE_XZ].up        = new THREE.Vector3( 0,  0, -1)
    @camera[constants.TDView].up          = new THREE.Vector3( 0,  0, -1)
    for cam in @camera
      cam.lookAt(new THREE.Vector3( 0, 0, 0))

    # Because the voxel coordinates do not have a cube shape but are distorted,
    # we need to distort the entire scene to provide an illustration that is
    # proportional to the actual size in nm.
    # For some reason, all objects have to be put into a group object. Changing
    # scene.scale does not have an effect.
    @group = new THREE.Object3D
    # The dimension(s) with the highest resolution will not be distorted
    @group.scale = app.scaleInfo.getNmPerVoxelVector()
    # Add scene to the group, all Geometries are than added to group
    @scene.add(@group)

    @scene.add( new THREE.AmbientLight(0x333333) )
    directionalLight = new THREE.DirectionalLight(0xffffff, 0.3)
    directionalLight.position.set(1, 1, -1).normalize()
    @scene.add( directionalLight )
    directionalLight = new THREE.DirectionalLight(0xffffff, 0.3)
    directionalLight.position.set(-1, -1, -1).normalize()
    @scene.add( directionalLight )

    # Attach the canvas to the container
    @renderer.setSize 2 * WIDTH + 20, 2 * HEIGHT + 20
    $(@renderer.domElement).attr("id": "render-canvas")
    container.append @renderer.domElement

    @setActiveViewport( constants.PLANE_XY )

    @first = true
    @newTextures = [true, true, true, true]

    @needsRerender = true
    app.vent.on("rerender", => @needsRerender = true)


  animate : ->

    return unless @running

    @renderFunction()

    window.requestAnimationFrame => @animate()

  renderFunction : ->
    # This is the main render function.
    # All 3D meshes and the trianglesplane are rendered here.

    TWEEN.update()

    # skip rendering if nothing has changed
    # This prevents you the GPU/CPU from constantly
    # working and keeps your lap cool
    # ATTENTION: this limits the FPS to 30 FPS (depending on the keypress update frequence)

    modelChanged = false
    for name, binary of @model.binary
      for plane in binary.planes
        modelChanged |= plane.hasChanged()

    if @needsRerender or modelChanged

      @trigger("render")

      viewport = [
        [0, @curWidth + 20],
        [@curWidth + 20, @curWidth + 20],
        [0, 0],
        [@curWidth + 20, 0]
      ]
      @renderer.autoClear = true

      setupRenderArea = (x, y, width, color) =>
        @renderer.setViewport x, y, width, width
        @renderer.setScissor  x, y, width, width
        @renderer.enableScissorTest true
        @renderer.setClearColor color, 1

      setupRenderArea( 0, 0, @renderer.domElement.width, 0xffffff )
      @renderer.clear()

      for i in constants.ALL_VIEWPORTS
        @trigger("renderCam", i)
        setupRenderArea(
          viewport[i][0] * @deviceScaleFactor,
          viewport[i][1] * @deviceScaleFactor,
          @curWidth * @deviceScaleFactor,
          constants.PLANE_COLORS[i]
        )
        @renderer.render(@scene, @camera[i])

      @needsRerender = false

  addGeometry : (geometry) ->
    # Adds a new Three.js geometry to the scene.
    # This provides the public interface to the GeometryFactory.

    @group.add geometry


  removeGeometry : (geometry) ->

    @group.remove geometry


  draw : ->
    app.vent.trigger("rerender")


  resizeThrottled : ->

    # throttle resize to avoid annoying flickering
    @resizeThrottled = _.throttle(
      =>
        @resize()
        app.vent.trigger("planes:resize")
      constants.RESIZE_THROTTLE_TIME
    )
    @resizeThrottled()


  resize : =>

    # Call this after the canvas was resized to fix the viewport
    canvas = $("#render-canvas")
    WIDTH = (canvas.width() - 20 ) / 2
    HEIGHT = (canvas.height() - 20 ) / 2

    @renderer.setSize(2 * WIDTH + 20, 2 * HEIGHT + 20)
    for i in constants.ALL_VIEWPORTS
      @camera[i].aspect = WIDTH / HEIGHT
      @camera[i].updateProjectionMatrix()
    @draw()


  scaleTrianglesPlane : (scale) =>

    @scaleFactor = scale
    @curWidth = WIDTH = HEIGHT = Math.round(@scaleFactor * constants.VIEWPORT_WIDTH)
    canvas = $("#render-canvas")
    canvas.width(2 * WIDTH + 20)
    canvas.height(2 * HEIGHT + 20)

    $('#TDViewControls button').outerWidth(@curWidth / 4 - 0.5)

    $(".inputcatcher")
      .css(
        width : WIDTH
        height : HEIGHT
      )

    @resizeThrottled()


  setActiveViewport : (viewportID) =>

    for i in [0..3]
      if i == viewportID
        $(".inputcatcher").eq(i).removeClass("inactive").addClass("active")
      else
        $(".inputcatcher").eq(i).removeClass("active").addClass("inactive")

    @draw()


  getCameras : =>

    @camera


  showBranchModalDouble : (callback) ->

    modal.show("You didn't add a node after jumping to this branchpoint, do you really want to jump again?",
      "Jump again?",
      [{id: "jump-button", label: "Jump again", callback: callback},
       {id: "cancel-button", label: "Cancel"}])


  showBranchModalDelete : (callback) ->

    modal.show("You are about to delete an unused branchpoint, are you sure?",
      "Delete branchpoint?",
      [{id: "delete-button", label: "Delete branchpoint", callback: callback},
       {id: "cancel-button", label: "Cancel"}])


  bindToEvents : ->

    if @model.skeletonTracing
      @listenTo(@model.skeletonTracing, "doubleBranch", @showBranchModalDouble)
      @listenTo(@model.skeletonTracing, "deleteBranch", @showBranchModalDelete)
      @listenTo(@model.skeletonTracing, "mergeDifferentTrees", ->
        Toast.error("You can't merge nodes within the same tree", false)
      )

    @listenTo(@model.user, "change:scale", (model, scale) ->
      if @running then @scaleTrianglesPlane(scale)
    )


  stop : ->

    $(".inputcatcher").hide()

    @running = false


  start : ->

    @running = true

    $(".inputcatcher").show()
    @scaleTrianglesPlane(@model.user.get("scale"))

    @animate()

module.exports = PlaneView
