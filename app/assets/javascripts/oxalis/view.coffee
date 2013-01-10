### define
jquery : $
./model/flycam : Flycam
./model/route : Route
./model/dimensions : DimensionsHelper
./view/abstractTreeViewer : AbstractTreeViewer
../libs/toast : Toast
../libs/event_mixin : EventMixin
../libs/Tween : TWEEN_LIB
###

#model : Model
    
# global View variables
# flycam = null

# constants
# display 512px out of 512px total width and height
#CAM_DISTANCE = 384/2 # alt: 384/2  #alt: 96
VIEWPORT_WIDTH = 380
PLANE_XY       = Dimensions.PLANE_XY
PLANE_YZ       = Dimensions.PLANE_YZ
PLANE_XZ       = Dimensions.PLANE_XZ
VIEW_3D        = Dimensions.VIEW_3D

class View

  constructor : (model, flycam) ->

    _.extend(@, new EventMixin())

    @model  = model
    @flycam = flycam

    # The "render" div serves as a container for the canvas, that is 
    # attached to it once a renderer has been initalized.
    container = $("#render")
    abstractTreeContainer = $("#abstractTreeViewer")
    # Create a 4x4 grid
    @curWidth = WIDTH = (container.width()-20)/2
    HEIGHT = (container.height()-20)/2
    @scaleFactor = 1

    # Initialize main THREE.js components
    colors    = [0xff0000, 0x0000ff, 0x00ff00, 0xffffff]
    @renderer = new THREE.WebGLRenderer({clearColor: colors[i], clearAlpha: 1, antialias: false})
    @camera   = new Array(4)
    @lights   = new Array(3)
    @scene    = new THREE.Scene()
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ, VIEW_3D]
      # Let's set up cameras
      # No need to set any properties, because the camera controller will deal with that
      @camera[i]   = new THREE.OrthographicCamera(0, 0, 0, 0)
      @scene.add @camera[i]

      # There is one light for each plane
      if i != VIEW_3D
        @lights[i]   = new THREE.PointLight( 0xffffff, 0.8 )
        @scene.add @lights[i]

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

    # Create Abstract Tree Viewer
    @abstractTreeViewer = new AbstractTreeViewer(abstractTreeContainer.width(), abstractTreeContainer.height())
    abstractTreeContainer.append @abstractTreeViewer.canvas
    @abstractTreeViewer.on
      nodeClick : (id) => @trigger("abstractTreeClick", id)

    # FPS stats
    stats = new Stats()
    stats.getDomElement().id = "stats"
    $("body").append stats.getDomElement() 
    @stats = stats
    @positionStats = $("#status")

    @first = true
    @newTextures = [true, true, true, true]
    # start the rendering loop
    @animate()

    # Dont forget to handle window resizing!
    $(window).resize( => @.resize() )

    @model.route.on("emptyBranchStack", =>
      Toast.error("No more branchpoints", false))

    @model.route.on({
                      newActiveNode : => @drawTree(),
                      newActiveTree : => @drawTree(),
                      deleteTree : => @drawTree(),
                      deleteActiveNode : => @drawTree(),
                      newNode : => @drawTree(),
                      mergeDifferentTrees : ->
                            Toast.error("You can't merge nodes within the same tree", false)  })
    
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
      for i in [PLANE_XY, PLANE_YZ, PLANE_XZ, VIEW_3D]
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
    container = $("#render")
    WIDTH = (container.width()-20)/2
    HEIGHT = (container.height()-20)/2

    @renderer.setSize( 2*WIDTH+20, 2*HEIGHT+20)
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ, VIEW_3D]
      @camera[i].aspect = WIDTH / HEIGHT
      @camera[i].updateProjectionMatrix()
    @draw()
  
  scaleTrianglesPlane : (delta) =>
    @scaleFactor = 1 unless @scaleFactor
    if (@scaleFactor+delta > 0.75) and (@scaleFactor+delta < 1.5)
      @scaleFactor += Number(delta)
      @curWidth = WIDTH = HEIGHT = @scaleFactor * 384
      container = $("#render")
      container.width(2 * WIDTH + 20)
      container.height(2 * HEIGHT + 20)

      divs = $(".inputcatcher")
      for div in divs
        $(div).width(WIDTH)
        $(div).height(HEIGHT)

      divYZ = $("#planeyz")
      divYZ.css({left: @scaleFactor * 384 + 20 + "px"})
      divXZ = $("#planexz")
      divXZ.css({top: @scaleFactor * 384 + 20 + "px"})
      divSkeleton = $("#skeletonview")
      divSkeleton.css({left: @scaleFactor * 384 + 20 + "px", top: @scaleFactor * 384 + 20 + "px"})

      # scales the 3D-view controls
      prevControl = $("#prevControls")
      prevControl.css({top: @scaleFactor * 420 + "px", left: @scaleFactor * 420 + "px"})

      @resize()

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

  getCameras : =>
    @camera

  getLights  : =>
    @lights

  drawTree : ->
    # Use node with minimal ID as root
    for node in @model.route.getTree().nodes
      if root?
        if root.id > node.id then root = node
      else 
        root = node
    @abstractTreeViewer.drawTree(root, @model.route.getActiveNodeId())

  createDoubleJumpModal : ->
    $("#double-jump").append("<div class=\"modal-body\">
            <p>You didn't add a node after jumping to this branchpoint, do you really want to jump again?</p>
          </div>
          <div class=\"modal-footer\">
            <a href=\"#\" id=\"jump-button\" class=\"btn\">Jump again</a>
            <a href=\"#\" id=\"cancel-button\" class=\"btn\">Cancel</a>
          </div>")

    $("#jump-button").on("click", => 
      @model.route.resolveBranchDeferred()
      $("#double-jump").modal("hide"))

    $("#cancel-button").on("click", => 
      @model.route.rejectBranchDeferred()
      $("#double-jump").modal("hide"))


  createKeyboardCommandOverlay : ->

    keycommands =
      "<table class=\"table table-condensed table-nohead\">
        <tbody>
          <tr><th colspan=\"2\">General</th><th colspan=\"2\">Viewports</th></tr>
          <tr><td>Leftclick or Arrow keys</td><td>Move</td><td>Mousewheel or D and F</td><td>Move along 3rd axis</td></tr>
          <tr><td>Leftclick</td><td>Select node</td><td>Rightclick</td><td>Set tracepoint</td></tr>
          <tr><td>Q</td><td>Fullscreen</td><td>I or Alt + Mousewheel</td><td>Zoom in</td></tr>
          <tr><td>K</td><td>Scale up viewports</td><td>O or Alt + Mousewheel</td><td>Zoom out</td></tr>
          <tr><td>L</td><td>Scale down viewports</td><td>B</td><td>Set branchpoint</td></tr>
          <tr><td>Del</td><td>Delete node/Split trees</td><td>J</td><td>Jump to last branchpoint</td></tr>
          <tr><td>Shift + Leftclick</td><td>Merge two trees</td><td>S</td><td>Center active node</td></tr>
          <tr><td>P</td><td>Previous comment</td><td>Shift + Mousewheel</td><td>Change active node size</td></tr>
          <tr><td>N</td><td>Next comment</td><td>C</td><td>Create new tree</td></tr>
          <tr><th colspan=\"2\">3D-view</th><td></td><td></td></tr>
          <tr><td>Mousewheel</td><td>Zoom in and out</td><td></td><td></td></tr>
        </tbody>
      </table>
      <br>
      <p>All other options like node-radius, moving speed, clipping distance can be adjusted in the options located to the left.
      Select the different categories to open/close them.
      Please report any issues.</p>"

    popoverTemplate = '<div class="popover key-overlay"><div class="arrow key-arrow"></div><div class="popover-inner"><h3 class="popover-title"></h3><div class="popover-content"><p></p></div></div></div>'
    $('#help-overlay').popover({html: true, placement: 'bottom', title: 'keyboard commands', content: keycommands, template: popoverTemplate})
