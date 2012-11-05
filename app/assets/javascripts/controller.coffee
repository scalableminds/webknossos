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
VIEWPORT_SIZE    = 380
WIDTH            = 384
TEXTURE_SIZE     = 512


class Controller

  constructor : ->

    _.extend(this, new EventMixin())

    @requestInitData().done (options) =>

      # create Model
      @model = new Model(options)

      @flycam = new Flycam(VIEWPORT_SIZE)
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

      @sceneController = new SceneController(@model.Route.data.dataSet.upperBoundary, @flycam, @model)
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
        
      # TODO
      @flycam.setGlobalPos(position)
      @flycam.setZoomSteps(data.zoomXY, data.zoomYZ, data.zoomXZ)
      @flycam.setOverrideZoomStep(data.minZoomStep)

      @initMouse()
      @initKeyboard()

      @gui = new Gui($("#optionswindow"), data, @model, @sceneController, @cameraController, @flycam)
      @gui.on "deleteActiveNode", @deleteActiveNode
      @gui.on "createNewTree", @createNewTree
      @gui.on "setActiveTree", (id) => @setActiveTree(id)
      @gui.on "setActiveNode", (id) => @setActiveNode(id, false) # not centered
      @gui.on "deleteActiveTree", @deleteActiveTree


      @cameraController.changePrevSV()
      @cameraController.setRouteClippingDistance data.routeClippingDistance
      @sceneController.setRouteClippingDistance data.routeClippingDistance
      @sceneController.setDisplayCrosshair data.displayCrosshair
      @sceneController.setDisplaySV PLANE_XY, data.displayPreviewXY
      @sceneController.setDisplaySV PLANE_YZ, data.displayPreviewYZ
      @sceneController.setDisplaySV PLANE_XZ, data.displayPreviewXZ
      @sceneController.skeleton.setDisplaySpheres data.nodesAsSpheres
      

  requestInitData : ->

    Request.send(
      url : "/game/initialize"
      dataType : "json"
    ).pipe (task) ->

      Request.send(
        url : "/experiment/#{task.task.id}"
        dataType : "json"
      ).pipe (options) ->

        Request.send(
          url : "/user/configuration"
          dataType : "json"
        ).pipe (user) ->

          options.user = user
          options

          ->

        alert("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")


  initMouse : ->

    # initializes an Input.Mouse object with the three canvas
    # elements and one pair of callbacks per canvas
    new Input.Mouse(
      [$("#planexy"), $("#planeyz"), $("#planexz"), $("#skeletonview")]
      [@view.setActivePlaneXY, @view.setActivePlaneYZ, @view.setActivePlaneXZ]
      {"x" : @moveX, "y" : @moveY, "w" : @moveZ, "l" : @onPlaneClick, "r" : @setWaypoint}
      {"x" : @cameraController.movePrevX, "y" : @cameraController.movePrevY, "w" : @cameraController.zoomPrev, "l" : @onPreviewClick}
    )

  initKeyboard : ->
    
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      if event.which == 32 or 37 <= event.which <= 40 then event.preventDefault();

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault(); return

    new Input.Keyboard(

      #Fullscreen Mode
      "f" : =>
        canvasesAndNav = @canvasesAndNav
        requestFullscreen = canvasesAndNav.webkitRequestFullScreen or canvasesAndNav.mozRequestFullScreen or canvasesAndNav.RequestFullScreen
        if requestFullscreen
          requestFullscreen.call(canvasesAndNav, canvasesAndNav.ALLOW_KEYBOARD_INPUT)

    
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
        @sceneController.skeleton.setBranchPoint(true)
      "j" : => @model.Route.popBranch().done(
        (id) => 
          @setActiveNode(id, true)
          @sceneController.skeleton.setBranchPoint(false)
        )
      "h" : @centerActiveNode

      #Zoom in/out
      "i" : =>
        @cameraController.zoomIn()
        # Remember Zoom Steps
        @model.User.Configuration.zoomXY = @flycam.getZoomStep(PLANE_XY)
        @model.User.Configuration.zoomYZ = @flycam.getZoomStep(PLANE_YZ)
        @model.User.Configuration.zoomXZ = @flycam.getZoomStep(PLANE_XZ)
        @model.User.Configuration.push()
      "o" : =>
        @cameraController.zoomOut()
        # Remember Zoom Steps
        @model.User.Configuration.zoomXY = @flycam.getZoomStep(PLANE_XY)
        @model.User.Configuration.zoomYZ = @flycam.getZoomStep(PLANE_YZ)
        @model.User.Configuration.zoomXZ = @flycam.getZoomStep(PLANE_XZ)
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
      # alternative key binding for Kevin
      "ctrl + space"  : => @moveZ(-@model.User.Configuration.moveValue)
    )


  render : =>

    @model.Binary.ping(@flycam.getGlobalPos(), @flycam.getIntegerZoomSteps())
    @model.Route.globalPosition = @flycam.getGlobalPos()
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
    curGlobalPos  = @flycam.getGlobalPos()
    zoomFactor    = @flycam.getPlaneScalingFactor @flycam.getActivePlane()
    activeNodePos = @model.Route.getActiveNodePos()
    scaleFactor   = @view.scaleFactor
    switch @flycam.getActivePlane()
      when PLANE_XY then position = [curGlobalPos[0] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*zoomFactor, curGlobalPos[1] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*zoomFactor, curGlobalPos[2]]
      when PLANE_YZ then position = [curGlobalPos[0], curGlobalPos[1] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*zoomFactor, curGlobalPos[2] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*zoomFactor]
      when PLANE_XZ then position = [curGlobalPos[0] - (WIDTH*scaleFactor/2 - relativePosition[0])/scaleFactor*zoomFactor, curGlobalPos[1], curGlobalPos[2] - (WIDTH*scaleFactor/2 - relativePosition[1])/scaleFactor*zoomFactor]
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
      if plane == VIEW_3D or (Math.abs(globalPos[ind[2]] - intersectsCoord[ind[2]]) < @cameraController.getRouteClippingDistance()+1)
      # intersects[0].object.material.color.setHex(Math.random() * 0xffffff)
        vertex = intersects[0].object.geometry.vertices[intersects[0].vertex]
      # set the active Node to the one that has the ID stored in the vertex
      # center the node if click was in 3d-view
        centered = plane == VIEW_3D
        @setActiveNode(vertex.nodeId, centered)

  ########### Model Interaction

  addNode : (position) =>
    if @model.User.Configuration.newNodeNewTree == true
      @createNewTree()
    @model.Route.put(position)
    @gui.updateNodeAndTreeIds()
    @gui.updateRadius()
    @sceneController.setWaypoint()

  setActiveNode : (nodeId, centered) =>
    @model.Route.setActiveNode(nodeId)
    if centered
      @centerActiveNode()
    @flycam.hasChanged = true
    @gui.update()
    @sceneController.skeleton.setActiveNode()

  centerActiveNode : =>
    @flycam.setGlobalPos(@model.Route.getActiveNodePos())

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
