### define
model : Model
view : View
geometry_factory : GeometryFactory
libs/event_mixin : EventMixin
input : Input
helper : Helper
libs/flycam2 : Flycam
geometries/plane : Plane
view/gui : Gui
controller/cameracontroller : CameraController
controller/scenecontroller : SceneController
###

PLANE_XY         = 0
PLANE_YZ         = 1
PLANE_XZ         = 2
VIEW_3D          = 3
VIEWPORT_WIDTH   = 380
WIDTH            = 384
TEXTURE_WIDTH    = 512


class Controller

  constructor : ->

    _.extend(this, new EventMixin())

    # create Model, View and Flycam
    @model = new Model()
    @flycam = new Flycam(VIEWPORT_WIDTH, @model)
    @view  = new View(@model, @flycam)

    # initialize Camera Controller
    @cameraController = new CameraController(@view.getCameras(), @view.getLights(), @flycam, @model, [2000, 2000, 2000])

    # FIXME probably not the best place?!
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      if event.which == 32 or 37 <= event.which <= 40 then event.preventDefault(); return

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault(); return

    @canvases = $("#render")[0]

    @prevControls = $('#prevControls')
    values        = ["XY Plane", "YZ Plane", "XZ Plane", "3D View"]
    callbacks     = [@cameraController.changePrevXY, @cameraController.changePrevYZ,
                      @cameraController.changePrevXZ, @cameraController.changePrevSV]
    buttons       = new Array(4)
    for i in [VIEW_3D, PLANE_XY, PLANE_YZ, PLANE_XZ]
      buttons[i] = document.createElement "input"
      buttons[i].setAttribute "type", "button"
      buttons[i].setAttribute "value", values[i]
      buttons[i].addEventListener "click", callbacks[i], true
      @prevControls.append buttons[i]

    @model.Route.initialize().then(
      (position) =>
        # Game.initialize() is called within Model.Route.initialize(), so it is also finished at this time.

        @sceneController = new SceneController([2000, 2000, 2000], @flycam, @model)
        meshes      = @sceneController.getMeshes()
        for mesh in meshes
          @view.addGeometry(mesh)
    
        @view.on "render", @render
        @view.on "renderCam", (id, event) => @sceneController.updateSceneForCam(id)
        @sceneController.skeleton.on "newGeometries", (list, event) =>
          for geometry in list
            @view.addGeometry(geometry)
        @sceneController.skeleton.on "removeGeometries", (list, event) =>
          for geometry in list
            @view.removeGeometry(geometry)
        
        @flycam.setGlobalPos(position)
        @cameraController.changePrevSV()

        ########## TEST #############
        #for i in [1..1000]
        #  if Math.random() < 0.2
        #    @model.Route.popBranch().done(
        #      (position) => 
        #        @flycam.setGlobalPos(position)
        #        @sceneController.setActiveNodePosition(position)
        #        #@gui.setActiveNodeId(@model.Route.getActiveNodeId())
        #      )
        #  pos = [Math.random() * 2000, Math.random() * 2000, Math.random() * 2000]
        #  if Math.random() < 0.3
        #    @model.Route.putBranch(pos)
        #    @sceneController.setWaypoint()
        #    #@gui.setActiveNodeId(@model.Route.getActiveNodeId())
        #  else
        #    @model.Route.putBranch(pos)
        #    @sceneController.setWaypoint()
        #    #@gui.setActiveNodeId(@model.Route.getActiveNodeId())

  
        @model.User.Configuration.initialize().then(
          (data) =>
            @initMouse() if data.mouseActive is true
            @initKeyboard() if data.keyboardActive is true
            @initGamepad() if data.gamepadActive is true
            @initMotionsensor() if data.motionsensorActive is true

            @gui = new Gui($("#optionswindow"), data, @model,
                            @sceneController, @cameraController, @flycam)
            @gui.on "deleteActiveNode", @deleteActiveNode
            @gui.on "createNewTree", @createNewTree
            @gui.on "setActiveTree", (id) => @setActiveTree(id)
            @gui.on "setActiveNode", (id) => @setActiveNode(id)
            @gui.on "deleteActiveTree", @deleteActiveTree

            @cameraController.setRouteClippingDistance data.routeClippingDistance
            @sceneController.setRouteClippingDistance data.routeClippingDistance
            @sceneController.setDisplayCrosshair data.displayCrosshair
            @sceneController.setDisplaySV PLANE_XY, data.displayPreviewXY
            @sceneController.setDisplaySV PLANE_YZ, data.displayPreviewYZ
            @sceneController.setDisplaySV PLANE_XZ, data.displayPreviewXZ
            @sceneController.skeleton.setDisplaySpheres data.nodesAsSpheres
        )
      
      ->
        alert("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
    )

  initMouse : ->
    # initializes an Input.Mouse object with the three canvas
    # elements and one pair of callbacks per canvas
    @input.mouses = new Input.Mouse(
      [$("#planexy"), $("#planeyz"), $("#planexz"), $("#skeletonview")]
      [@view.setActivePlaneXY, @view.setActivePlaneYZ, @view.setActivePlaneXZ]
      {"x" : @moveX, "y" : @moveY, "w" : @moveZ, "l" : @onPlaneClick, "r" : @setWaypoint}
      {"x" : @cameraController.movePrevX, "y" : @cameraController.movePrevY, "w" : @cameraController.zoomPrev, "l" : @onPreviewClick}
    )

  initKeyboard : ->

    # TODO: (from Georg) I do not get the difference between Keyboard
    # and KeyboardNoLoop. KeyboardNoLoop implies that pressing the key
    # longer will not trigger the callback several times, but this is
    # false, apparently. I moved the space to KeyboardNoLoop, because
    # it allows more accuracy.
    
    @input.keyboard = new Input.Keyboard(

      #Fullscreen Mode
      "f" : => 
        canvases = @canvases
        requestFullscreen = canvases.webkitRequestFullScreen or canvases.mozRequestFullScreen or canvases.RequestFullScreen
        if requestFullscreen
          requestFullscreen.call(canvases, canvases.ALLOW_KEYBOARD_INPUT)

    
      #ScaleTrianglesPlane
      "l" : => @view.scaleTrianglesPlane -@model.User.Configuration.scaleValue
      "k" : => @view.scaleTrianglesPlane @model.User.Configuration.scaleValue

      #Move
      "w"             : => @moveY(-@model.User.Configuration.moveValue)
      "s"             : => @moveY( @model.User.Configuration.moveValue)
      "a"             : => @moveX(-@model.User.Configuration.moveValue)
      "d"             : => @moveX( @model.User.Configuration.moveValue)
      #"space"         : => @moveZ( @model.User.Configuration.moveValue)
      #"shift + space" : => @moveZ(-@model.User.Configuration.moveValue)

      #Rotate in distance
      "left"          : => @moveX(-@model.User.Configuration.moveValue)
      "right"         : => @moveX( @model.User.Configuration.moveValue)
      "up"            : => @moveY(-@model.User.Configuration.moveValue)
      "down"          : => @moveY( @model.User.Configuration.moveValue)

      #misc keys
      # TODO: what does this? I removed it, I need the key.
      #"n" : => Helper.toggle()
      #"ctr + s"       : => @model.Route.pushImpl()
    )
    
    new Input.KeyboardNoLoop(
      #Branches
      "b" : => 
        @model.Route.putBranch()
      "j" : => @model.Route.popBranch().done(
        (id) => 
          @setActiveNode(id)
        )

      #Zoom in/out
      "i" : =>
        @cameraController.zoomIn()
        # Remember Zoom Steps
        @model.User.Configuration.zoom0 = @flycam.getZoomStep(0)
        @model.User.Configuration.zoom1 = @flycam.getZoomStep(1)
        @model.User.Configuration.zoom2 = @flycam.getZoomStep(2)
        @model.User.Configuration.push()
      "o" : =>
        @cameraController.zoomOut()
        # Remember Zoom Steps
        @model.User.Configuration.zoom0 = @flycam.getZoomStep(0)
        @model.User.Configuration.zoom1 = @flycam.getZoomStep(1)
        @model.User.Configuration.zoom2 = @flycam.getZoomStep(2)
        @model.User.Configuration.push()

      # delete active node
      "delete" : =>
        # just use the method implemented in gui
        @deleteActiveNode()

      "n" : =>
        @createNewTree()

      # Move
      "space"         : => @moveZ( @model.User.Configuration.moveValue)
      "shift + space" : => @moveZ(-@model.User.Configuration.moveValue)
    )

  # for more buttons look at Input.Gamepad
  #initGamepad : ->
  #  @input.gamepad = new Input.Gamepad(
  #      "ButtonA" : -> @view.move [0, 0, @model.User.Configuration.moveValue]
  #      "ButtonB" : -> @view.move [0, 0, -@model.User.Configuration.moveValue]
  #  )

  #initMotionsensor : ->
  #  @input.deviceorientation = new Input.Deviceorientation(
    # TODO implement functionality
    #  "x"  : View.yawDistance
    #  "y" : View.pitchDistance
   # )

  #initDeviceOrientation : ->
  #  @input.deviceorientation = new Input.Deviceorientation(
    # TODO implement functionality
    #  "x"  : View.yawDistance
    #  "y" : View.pitchDistance
  #  )

  input :
    mouses : null
    mouseXY : null
    mouseXZ : null
    mouseYZ : null
    keyboard : null
    gamepad : null
    deviceorientation : null

  render : =>
    @model.Binary.ping(@flycam.getGlobalPos(), @flycam.getIntegerZoomSteps())
    if (@gui)
      @gui.updateGlobalPosition()
    @cameraController.update()
    @sceneController.update()

  move  : (v) =>                 # v: Vector represented as array of length 3
    @flycam.moveActivePlane(v)

  moveX : (x) => @move([x, 0, 0])
  moveY : (y) => @move([0, y, 0])
  moveZ : (z) => @move([0, 0, z])

  ########### Click callbacks
  
  setWaypoint : (relativePosition, typeNumber) =>
    curGlobalPos = @flycam.getGlobalPos()
    zoomFactor   = @flycam.getPlaneScalingFactor @flycam.getActivePlane()
    scaleFactor  = @view.scaleFactor
    switch @flycam.getActivePlane()
      when PLANE_XY then position = [curGlobalPos[0] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*zoomFactor, curGlobalPos[1] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*zoomFactor, curGlobalPos[2]]
      when PLANE_YZ then position = [curGlobalPos[0], curGlobalPos[1] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*zoomFactor, curGlobalPos[2] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*zoomFactor]
      when PLANE_XZ then position = [curGlobalPos[0] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*zoomFactor, curGlobalPos[1], curGlobalPos[2] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*zoomFactor]
    @addNode(position)

  onPreviewClick : (position) =>
    @onClick(position, VIEW_3D)

  onPlaneClick : (position) =>
    plane = @flycam.getActivePlane()
    @onClick(position, plane)

  onClick : (position, plane) =>
    scaleFactor = @view.scaleFactor
    camera      = @view.getCameras()[plane]
    # vector with direction from camera position to click position
    vector = new THREE.Vector3((position[0] / (384 * scaleFactor) ) * 2 - 1, - (position[1] / (384 * scaleFactor)) * 2 + 1, 0.5)
    
    # create a ray with the direction of this vector, set ray threshold depending on the zoom of the 3D-view
    projector = new THREE.Projector()
    ray = projector.pickingRay(vector, camera)
    ray.setThreshold(@flycam.getRayThreshold(plane))
 
    # identify clicked object
    intersects = ray.intersectObjects(@sceneController.skeleton.nodes)

    if intersects.length > 0 and intersects[0].distance >= 0
      intersectsCoord = [intersects[0].point.y, intersects[0].point.x, intersects[0].point.z]
      globalPos = @flycam.getGlobalPos()
      clickCoords = [globalPos[1], globalPos[0], globalPos[2]]

      # console.log clickCoords[2 - plane]
      # console.log intersectsCoord[2 - plane]
      # console.log @cameraController.getRouteClippingDistance()
      # console.log Math.abs(clickCoords[2 - plane] - intersectsCoord[2 - plane])

      # make sure you can't click nodes, that are clipped away (one can't see)
      if plane == 3 or (Math.abs(clickCoords[2 - plane] - intersectsCoord[2 - plane]) < @cameraController.getRouteClippingDistance())
      # intersects[0].object.material.color.setHex(Math.random() * 0xffffff)
        vertex = intersects[0].object.geometry.vertices[intersects[0].vertex]
      # set the active Node to the one that has the ID stored in the vertex
        @setActiveNode(vertex.nodeId)

  ########### Model Interaction

  addNode : (position) =>
    if @model.User.Configuration.newNodeNewTree == true
      @createNewTree()
    @model.Route.put(position)
    @gui.updateNodeAndTreeIds()
    @gui.updateRadius()
    @sceneController.setWaypoint()

  setActiveNode : (nodeId) =>
    @model.Route.setActiveNode(nodeId)
    #### isn't centered anymore, was distracting in the viewports, wrote a mail to kevin to ask for his favourite behaviour
    #@flycam.setGlobalPos(@model.Route.getActiveNodePos())
    @flycam.hasChanged = true
    @gui.update()
    @sceneController.skeleton.setActiveNode()

  deleteActiveNode : =>
    @model.Route.deleteActiveNode()
    @gui.update()
    @sceneController.updateRoute()

  createNewTree : =>
    id = @model.Route.createNewTree()
    @gui.update()
    @sceneController.skeleton.createNewTree(id)

  setActiveTree : (treeId) =>
    @model.Route.setActiveTree(treeId)
    @gui.update()
    @sceneController.updateRoute()

  deleteActiveTree : =>
    @model.Route.deleteActiveTree()
    @gui.update()
    @sceneController.updateRoute()

  ########### Input Properties

  #Customize Options
  setMoveValue : (value) =>
    @model.User.Configuration.moveValue = (Number) value

    @model.User.Configuration.push()

  setRotateValue : (value) =>
    @model.User.Configuration.rotateValue = (Number) value 
    @model.User.Configuration.push()   

  setScaleValue : (value) =>
    @model.User.Configuration.scaleValue = (Number) value  
    @model.User.Configuration.push()         

  setMouseRotateValue : (value) =>
    @model.User.Configuration.mouseRotateValue = (Number) value
    @model.User.Configuration.push()             

  setMouseActivity : (value) =>
    @model.User.Configuration.mouseActive = value
    @model.User.Configuration.push()
    if value is false
      @input.mouse.unbind()
      @input.mouse = null
    else
      @initMouse()

  setKeyboardActivity : (value) =>
    @model.User.Configuration.keyboardActive = value 
    @model.User.Configuration.push()
    if value is false
      @input.keyboard.unbind()
      @input.keyboard = null
    else
      @initKeyboard()

  setGamepadActivity : (value) =>
    @model.User.Configuration.gamepadActive = value  
    @model.User.Configuration.push()   
    if value is false
      @input.gamepad.unbind()
      @input.gamepad = null
    else
      @initGamepad()    

  setMotionSensorActivity : (value) =>
    @model.User.Configuration.motionsensorActive = value
    @model.User.Configuration.push()   
    if value is false
      @input.deviceorientation.unbind()
      @input.deviceorientation = null
    else
      @initMotionsensor()
