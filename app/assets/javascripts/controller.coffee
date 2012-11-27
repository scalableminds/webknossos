### define
jquery : $
underscore : _
controller/cameracontroller : CameraController
controller/scenecontroller : SceneController
model : Model
view : View
view/gui : Gui
input : Input
libs/request : Request
libs/flycam : Flycam
libs/event_mixin : EventMixin
###

PLANE_XY         = 0
PLANE_YZ         = 1
PLANE_XZ         = 2
VIEW_3D          = 3
VIEWPORT_WIDTH   = 380
WIDTH            = 384
TEXTURE_SIZE     = 512


class Controller

  constructor : ->

    _.extend(@, new EventMixin())

    @requestInitData().done (options) =>

      # create Model
      @model = new Model(options)
      @flycam = new Flycam(VIEWPORT_WIDTH, @model)
      @view  = new View(@model, @flycam)

      # initialize Camera Controller
      @cameraController = new CameraController(@view.getCameras(), @view.getLights(), @flycam, @model)

      @canvasesAndNav = $("#main")[0]

      @prevControls = $('#prevControls')
      @prevControls.addClass("btn-group")
      values        = ["XY Plane", "YZ Plane", "XZ Plane", "3D View"]
      callbacks     = [@cameraController.changePrevXY, @cameraController.changePrevYZ,
                        @cameraController.changePrevXZ, @cameraController.changePrevSV]
      buttons       = new Array(4)
    
      for i in [VIEW_3D, PLANE_XY, PLANE_YZ, PLANE_XZ]

        buttons[i] = $("<input>", type : "button", class : "btn btn-small", value : values[i])
        buttons[i].on("click", callbacks[i])
        @prevControls.append(buttons[i])

      @view.createKeyboardCommandOverlay()

      @sceneController = new SceneController(@model.route.dataSet.upperBoundary, @flycam, @model)
      meshes = @sceneController.getMeshes()
      
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

      @gui = new Gui($("#optionswindow"), @model, @sceneController, @cameraController, @flycam)
      @gui.on "deleteActiveNode", @deleteActiveNode
      @gui.on "createNewTree", @createNewTree
      @gui.on "setActiveTree", (id) => @setActiveTree(id)
      @gui.on "setActiveNode", (id) => @setActiveNode(id, false) # not centered
      @gui.on "deleteActiveTree", @deleteActiveTree

      @flycam.setGlobalPos(@model.route.data.editPosition)
      @flycam.setZoomSteps(@model.user.zoomXY, @model.user.zoomYZ, @model.user.zoomXZ)
      @flycam.setOverrideZoomStep(@model.user.minZoomStep)

      @initMouse()
      @initKeyboard()

      @cameraController.changePrevSV()
      @cameraController.setRouteClippingDistance @model.user.routeClippingDistance
      @sceneController.setRouteClippingDistance @model.user.routeClippingDistance
      @sceneController.setDisplayCrosshair @model.user.displayCrosshair
      @sceneController.setDisplaySV PLANE_XY, @model.user.displayPreviewXY
      @sceneController.setDisplaySV PLANE_YZ, @model.user.displayPreviewYZ
      @sceneController.setDisplaySV PLANE_XZ, @model.user.displayPreviewXZ
      @sceneController.skeleton.setDisplaySpheres @model.user.nodesAsSpheres
      

  requestInitData : ->

    Request.send(
      url : "/game/initialize"
      dataType : "json"
    ).pipe (task) ->

      Request.send(
        url : "/tracing/#{task.task.id}"
        dataType : "json"
      ).pipe (tracing) ->

        Request.send(
          url : "/user/configuration"
          dataType : "json"
        ).pipe((user) ->

          options = {}
          options.user = user
          options.dataSet = tracing.dataSet
          options.tracing = tracing.tracing
          options

        -> alert("Ooops. We couldn't communicate with our mother ship. Please try to reload this page."))


  initMouse : ->

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault()
      return

    for planeId in ["xy", "yz", "xz"]
      new Input.Mouse($("#plane#{planeId}"),
        over : @view["setActivePlane#{planeId.toUpperCase()}"]
        leftDownMove : (delta) => 
          @move [
            delta.x * @model.user.mouseInversionX
            delta.y * @model.user.mouseInversionX
            0
          ]
        scroll : @scroll
        leftClick : @onPlaneClick
        rightClick : @setWaypoint
      )

    new Input.Mouse($("#skeletonview"),
      leftDownMove : (delta) => 
        @cameraController.movePrevX(delta.x * @model.user.mouseInversionX)
        @cameraController.movePrevY(delta.y * @model.user.mouseInversionX)
      scroll : @cameraController.zoomPrev
      leftClick : @onPreviewClick
    )


  initKeyboard : ->
    
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or 37 <= event.which <= 40) and !$(":focus").length
      return

    new Input.Keyboard(

      #Fullscreen Mode
      "q" : =>
        canvasesAndNav = @canvasesAndNav
        requestFullscreen = canvasesAndNav.webkitRequestFullScreen or canvasesAndNav.mozRequestFullScreen or canvasesAndNav.RequestFullScreen
        if requestFullscreen
          requestFullscreen.call(canvasesAndNav, canvasesAndNav.ALLOW_KEYBOARD_INPUT)

    
      #ScaleTrianglesPlane
      "l" : => @view.scaleTrianglesPlane(-@model.user.scaleValue)
      "k" : => @view.scaleTrianglesPlane( @model.user.scaleValue)

      #Move
      "left"  : => @moveX(-@model.user.moveValue)
      "right" : => @moveX( @model.user.moveValue)
      "up"    : => @moveY(-@model.user.moveValue)
      "down"  : => @moveY( @model.user.moveValue)

      #misc keys
      # TODO: what does this? I removed it, I need the key.
      #"n" : => Helper.toggle()
      #"ctr + s"       : => @model.route.pushImpl()
    )
    
    new Input.KeyboardNoLoop(
      #Branches
      "b" : => 
        @model.route.putBranch()
        @sceneController.skeleton.setBranchPoint(true)
      "j" : => @model.route.popBranch().done(
        (id) => 
          @setActiveNode(id, true)
          @sceneController.skeleton.setBranchPoint(false)
        )
      "s" : @centerActiveNode

      #Zoom in/out
      "i" : =>
        @zoomIn()
      "o" : =>
        @zoomOut()

      # delete active node
      "delete" : =>
        # just use the method implemented in gui
        @deleteActiveNode()

      "n" : =>
        @createNewTree()

      # Move
      "space" : => @moveZ( @model.user.moveValue)
      "f" : => @moveZ( @model.user.moveValue)
      #"space, f"         : => @moveZ( @model.user.moveValue)
      "shift + space" : => @moveZ(-@model.user.moveValue)
      "ctrl + space" : => @moveZ(-@model.user.moveValue)
      "d" : => @moveZ(-@model.user.moveValue)
      #"shift + space, ctrl + space, d" : => @moveZ(-@model.user.moveValue)
    )


  render : =>

    @model.binary.ping(@flycam.getGlobalPos(), @flycam.getIntegerZoomSteps())
    @model.route.globalPosition = @flycam.getGlobalPos()
    @cameraController.update()
    @sceneController.update()

  move : (v) =>                 # v: Vector represented as array of length 3
    @flycam.moveActivePlane(v)

  moveX : (x) => @move([x, 0, 0])
  moveY : (y) => @move([0, y, 0])
  moveZ : (z) => @move([0, 0, z])

  zoomIn : =>
    @cameraController.zoomIn()
    # Remember Zoom Steps
    @model.user.zoomXY = @flycam.getZoomStep(PLANE_XY)
    @model.user.zoomYZ = @flycam.getZoomStep(PLANE_YZ)
    @model.user.zoomXZ = @flycam.getZoomStep(PLANE_XZ)
    @model.user.push()

  zoomOut : =>
    @cameraController.zoomOut()
    # Remember Zoom Steps
    @model.user.zoomXY = @flycam.getZoomStep(PLANE_XY)
    @model.user.zoomYZ = @flycam.getZoomStep(PLANE_YZ)
    @model.user.zoomXZ = @flycam.getZoomStep(PLANE_XZ)
    @model.user.push()

  setNodeRadius : (delta) =>
    lastRadius = @model.route.getActiveNodeRadius()
    radius = lastRadius + (lastRadius/20 * delta) #achieve logarithmic change behaviour
    scale = @model.route.scaleX
    if radius < scale
      radius = scale
    else if radius > 1000 * scale
      radius = 1000 * scale
    @gui.setNodeRadius(radius)
    @gui.updateRadius()

  scroll : (delta, type) =>
    switch type
      when null then @moveZ(delta)
      when "shift" then @setNodeRadius(delta)
      when "alt"
        if delta > 0
          @zoomIn()
        else
          @zoomOut()


  ########### Click callbacks
  
  setWaypoint : (relativePosition, typeNumber) =>
    curGlobalPos  = @flycam.getGlobalPos()
    zoomFactor    = @flycam.getPlaneScalingFactor @flycam.getActivePlane()
    activeNodePos = @model.route.getActiveNodePos()
    scaleFactor   = @view.scaleFactor
    planeRatio    = @flycam.getSceneScalingArray()
    switch @flycam.getActivePlane()
      when PLANE_XY then position = [curGlobalPos[0] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*planeRatio[0]*zoomFactor, curGlobalPos[1] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*planeRatio[1]*zoomFactor, curGlobalPos[2]]
      when PLANE_YZ then position = [curGlobalPos[0], curGlobalPos[1] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*planeRatio[1]*zoomFactor, curGlobalPos[2] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*planeRatio[2]*zoomFactor]
      when PLANE_XZ then position = [curGlobalPos[0] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*planeRatio[0]*zoomFactor, curGlobalPos[1], curGlobalPos[2] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*planeRatio[2]*zoomFactor]
    # set the new trace direction
    if activeNodePos
      p = [position[0] - activeNodePos[0], position[1] - activeNodePos[1], position[2] - activeNodePos[2]]
      @flycam.setDirection(p)
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
      intersectsCoord = [intersects[0].point.x, intersects[0].point.y, intersects[0].point.z]
      globalPos = @flycam.getGlobalPos()

      # make sure you can't click nodes, that are clipped away (one can't see)
      ind = @flycam.getIndices(plane)
      if plane == VIEW_3D or (Math.abs(globalPos[ind[2]] - intersectsCoord[ind[2]]) < @cameraController.getRouteClippingDistance(ind[2])+1)
      # intersects[0].object.material.color.setHex(Math.random() * 0xffffff)
        vertex = intersects[0].object.geometry.vertices[intersects[0].vertex]
      # set the active Node to the one that has the ID stored in the vertex
      # center the node if click was in 3d-view
        centered = plane == VIEW_3D
        @setActiveNode(vertex.nodeId, centered)

  ########### Model Interaction

  addNode : (position) =>
    if @model.user.newNodeNewTree == true
      @createNewTree()
    @model.route.put(position)
    @gui.updateNodeAndTreeIds()
    @gui.updateRadius()
    @sceneController.setWaypoint()

  setActiveNode : (nodeId, centered) =>
    @model.route.setActiveNode(nodeId)
    if centered
      @centerActiveNode()
    @flycam.hasChanged = true
    @gui.update()
    @sceneController.skeleton.setActiveNode()

  centerActiveNode : =>
    @flycam.setGlobalPos(@model.route.getActiveNodePos())

  deleteActiveNode : =>
    @model.route.deleteActiveNode()
    @gui.update()
    @sceneController.updateRoute()

  createNewTree : =>
    [id, color] = @model.route.createNewTree()
    @gui.update()
    @sceneController.skeleton.createNewTree(id, color)

  setActiveTree : (treeId) =>
    @model.route.setActiveTree(treeId)
    @gui.update()
    @sceneController.updateRoute()

  deleteActiveTree : =>
    @model.route.deleteActiveTree()
    @gui.update()
    @sceneController.updateRoute()

  ########### Input Properties

  #Customize Options
  setMoveValue : (value) =>
    @model.user.moveValue = (Number) value

    @model.user.push()

  setRotateValue : (value) =>
    @model.user.rotateValue = (Number) value 
    @model.user.push()   

  setScaleValue : (value) =>
    @model.user.scaleValue = (Number) value  
    @model.user.push()         

  setMouseRotateValue : (value) =>
    @model.user.mouseRotateValue = (Number) value
    @model.user.push()             
