### define
jquery : $
../model/dimensions : Dimensions
../../libs/toast : Toast
../../libs/event_mixin : EventMixin
../../libs/Tween : TWEEN_LIB
../constants : constants
###

class PlaneView

  MAX_SCALE      : 20
  MIN_SCALE      : 0.5

  constructor : (@model, @flycam, @stats) ->

    _.extend(@, new EventMixin())

    @running = false

    # The "render" div serves as a container for the canvas, that is 
    # attached to it once a renderer has been initalized.
    container = $("#render")

    # Create a 4x4 grid
    @curWidth = WIDTH = constants.VIEWPORT_WIDTH
    HEIGHT = constants.VIEWPORT_WIDTH
    @scaleFactor = 1

    # Initialize main THREE.js components
    colors    = [0xff0000, 0x0000ff, 0x00ff00, 0xffffff]
    @renderer = new THREE.WebGLRenderer({clearColor: colors[i], clearAlpha: 1, antialias: false})
    @camera   = new Array(4)
    @lights   = new Array(3)
    @scene    = new THREE.Scene()
    for i in constants.ALL_VIEWPORTS
      # Let's set up cameras
      # No need to set any properties, because the camera controller will deal with that
      @camera[i]   = new THREE.OrthographicCamera(0, 0, 0, 0)
      @scene.add @camera[i]

      # There is one light for each plane
      if i != constants.VIEW_3D
        @lights[i]   = new THREE.PointLight( 0xffffff, 0.8 )
        @scene.add @lights[i]

    @camera[constants.PLANE_XY].position.z = -1
    @camera[constants.PLANE_YZ].position.x =  1
    @camera[constants.PLANE_XZ].position.y =  1
    @camera[constants.VIEW_3D].position    = new THREE.Vector3(10, 10, -10)
    @camera[constants.PLANE_XY].up         = new THREE.Vector3( 0, -1,  0)
    @camera[constants.PLANE_YZ].up         = new THREE.Vector3( 0, -1,  0)
    @camera[constants.PLANE_XZ].up         = new THREE.Vector3( 0,  0, -1)
    @camera[constants.VIEW_3D].up          = new THREE.Vector3( 0,  0, -1)
    for cam in @camera
      cam.lookAt(new THREE.Vector3( 0, 0, 0))

    # Because the voxel coordinates do not have a cube shape but are distorted,
    # we need to distort the entire scene to provide an illustration that is
    # proportional to the actual size in nm.
    # For some reason, all objects have to be put into a group object. Changing
    # scene.scale does not have an effect.
    @group = new THREE.Object3D
    # The dimension(s) with the highest resolution will not be distorted
    @group.scale = @model.scaleInfo.getNmPerVoxelVector()
    # Add scene to the group, all Geometries are than added to group
    @scene.add(@group)

    # Attach the canvas to the container
    @renderer.setSize 2*WIDTH+20, 2*HEIGHT+20
    container.append @renderer.domElement

    @setActivePlaneXY()

    @positionStats = $("#status")

    @first = true
    @newTextures = [true, true, true, true]
    # start the rendering loop

    # Dont forget to handle window resizing!
    $(window).resize( => @.resize() )

    @modalCallbacks = {}
    
    # refresh the scene once a bucket is loaded
    # FIXME: probably not the most elgant thing to do
    # FIXME: notifies all planes when any bucket is loaded
    # $(window).on("bucketloaded", => @flycam.hasChanged = true; @flycam.newBuckets = [true, true, true]) 

  animate : ->

    @renderFunction()

    if @running is true
      window.requestAnimationFrame => @animate()

  # This is the main render function.
  # All 3D meshes and the trianglesplane are rendered here.
  renderFunction : ->

    TWEEN.update()

    @trigger "render"

    # skip rendering if nothing has changed
    # This prevents you the GPU/CPU from constantly
    # working and keeps your lap cool
    # ATTENTION: this limits the FPS to 30 FPS (depending on the keypress update frequence)
    
    # update postion and FPS displays
    @stats.update()

    viewport = [[0, @curWidth+20], [@curWidth+20, @curWidth+20], [0, 0], [@curWidth+20, 0]]
    @renderer.autoClear = true
    colors   = [ 0xff0000, 0x0000ff, 0x00ff00, 0xffffff]
    if @flycam.hasChanged or @flycam.hasNewTextures()
      for i in constants.ALL_VIEWPORTS
        @trigger "renderCam", i
        @renderer.setViewport(viewport[i][0], viewport[i][1], @curWidth, @curWidth)
        @renderer.setScissor(viewport[i][0], viewport[i][1], @curWidth, @curWidth)
        @renderer.enableScissorTest(true)
        @renderer.setClearColorHex(colors[i], 1);
        @renderer.render @scene, @camera[i]
    @flycam.hasChanged = false
    @flycam.hasNewTexture = [false, false, false]
  
  # Adds a new Three.js geometry to the scene.
  # This provides the public interface to the GeometryFactory.
  addGeometry : (geometry) ->
    @group.add geometry

  removeGeometry : (geometry) ->
    @group.remove geometry

  #Apply a single draw (not used right now)
  draw : ->
    #FIXME: this is dirty
    @flycam.hasChanged = true

  #Call this after the canvas was resized to fix the viewport
  resize : ->
    #FIXME: Is really the window's width or rather the DIV's?
    canvas = $("#render > canvas")
    WIDTH = (canvas.width()-20)/2
    HEIGHT = (canvas.height()-20)/2

    @renderer.setSize( 2*WIDTH+20, 2*HEIGHT+20)
    for i in constants.ALL_VIEWPORTS
      @camera[i].aspect = WIDTH / HEIGHT
      @camera[i].updateProjectionMatrix()
    @draw()
  
  scaleTrianglesPlane : (delta) =>
    @scaleFactor = 1 unless @scaleFactor
    if (@scaleFactor+delta > @MIN_SCALE) and (@scaleFactor+delta < @MAX_SCALE)
      @scaleFactor += Number(delta)
      @curWidth = WIDTH = HEIGHT = @scaleFactor * 380
      canvas = $("#render > canvas")
      canvas.width(2 * WIDTH + 20)
      canvas.height(2 * HEIGHT + 20)

      divs = $(".inputcatcher")
      for div in divs
        $(div).css({width: WIDTH + "px"})
        $(div).css({height: HEIGHT + "px"})

      @resize()

  setActivePlaneXY : =>
    @setActivePlane constants.PLANE_XY

  setActivePlaneYZ : =>
    @setActivePlane constants.PLANE_YZ

  setActivePlaneXZ : =>
    @setActivePlane constants.PLANE_XZ

  setActivePlane : (planeID) =>
    @flycam.setActivePlane planeID
    for i in [0..2]
      $(".inputcatcher")[i].style.borderWidth = if i==planeID then "2px" else "0px"
    @flycam.hasChanged = true

  getCameras : =>
    @camera

  getLights  : =>
    @lights

  # buttons: [{id:..., label:..., callback:...}, ...]
  showModal : (text, buttons) ->

    html =  "<div class=\"modal-body\"><p>" + text + "</p></div>"

    html += "<div class=\"modal-footer\">"
    for button in buttons
      html += "<a href=\"#\" id=\"" + button.id + "\" class=\"btn\">" +
                    button.label + "</a>"
    html += "</div>"

    $("#modal").html(html)

    for button in buttons
      @modalCallbacks[button.id] = button.callback
      $("#" + button.id).on("click", (evt) =>
        callback = @modalCallbacks[evt.target.id]
        if callback? then callback()
        $("#modal").modal("hide"))

    $("#modal").modal("show")


  showFirstVisToggle : ->
    @showModal("You just toggled the skeleton visibility. To toggle back, just hit the 1-Key.",
      [{id: "ok-button", label: "OK, Got it."}])

  showBranchModal : (callback) ->
    @showModal("You didn't add a node after jumping to this branchpoint, do you really want to jump again?",
      [{id: "jump-button", label: "Jump again", callback: callback},
       {id: "cancel-button", label: "Cancel"}])

  hideModal : ->
    $("#modal").modal("hide")

  bind : ->  

    @model.route.on({
      doubleBranch         : (callback) => @showBranchModal(callback)      
      mergeDifferentTrees  : ->
        Toast.error("You can't merge nodes within the same tree", false) })
    
    
  stop : ->

    @scaleFactor = 1
    @scaleTrianglesPlane(0)
    @running = false 


  start : ->

    @running = true
    @animate()
