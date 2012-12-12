### define
../../libs/datgui/dat.gui : DatGui
../../libs/request : Request
../../libs/event_mixin : EventMixin
../../libs/toast : Toast
../model/dimensions : DimensionsHelper
###

PLANE_XY           = Dimensions.PLANE_XY
PLANE_YZ           = Dimensions.PLANE_YZ
PLANE_XZ           = Dimensions.PLANE_XZ
VIEW_3D            = Dimensions.VIEW_3D

class Gui 

  model : null
  sceneController : null
  cameraController : null
  flycam : null
  
  constructor : (container, @model, @sceneController, @cameraController, @flycam) ->
    
    _.extend(this, new EventMixin())

    data = @model.user
    # create GUI
    modelRadius = @model.route.getActiveNodeRadius()
    @settings = 
      
      lockZoom: data.lockZoom
      inverseX: data.mouseInversionX == 1
      inverseY: data.mouseInversionY == 1

      moveValue : data.moveValue
      routeClippingDistance: data.routeClippingDistance
      displayCrosshairs: data.displayCrosshair
      interpolation : data.interpolation
      minZoomStep : data.minZoomStep

      displayPrevXY : data.displayPreviewXY
      displayPrevYZ : data.displayPreviewYZ
      displayPrevXZ : data.displayPreviewXZ
      nodesAsSpheres : data.nodesAsSpheres

      activeTreeID : @model.route.getActiveTreeId()
      newTree : => @trigger "createNewTree"
      deleteActiveTree : => @trigger "deleteActiveTree"

      activeNodeID : @model.route.getActiveNodeId()
      newNodeNewTree : data.newNodeNewTree
      deleteActiveNode : => @trigger "deleteActiveNode"
      radius : if modelRadius then modelRadius else 10 * @model.scaleInfo.baseVoxel


    @gui = new dat.GUI(autoPlace: false, width : 280, hideable : false, closed : true)

    container.append @gui.domElement
    
    fControls = @gui.addFolder("Controls")
    (fControls.add @settings, "lockZoom")
                          .name("Lock Zoom")
                          .onChange(@setLockZoom)
    (fControls.add @settings, "inverseX")
                          .name("Inverse X")
                          .onChange(@setMouseInversionX)
    (fControls.add @settings, "inverseY")
                          .name("Inverse Y")
                          .onChange(@setMouseInversionY)

    fView = @gui.addFolder("Planes")
    (fView.add @settings, "moveValue", 1, 10) 
                          .step(0.25)
                          .name("Move Value")    
                          .onChange(@setMoveValue)
    scale = @model.scaleInfo.baseVoxel
    (fView.add @settings, "routeClippingDistance", 1, 1000 * scale)
                          .name("Clipping Distance")    
                          .onChange(@setRouteClippingDistance)
    (fView.add @settings, "displayCrosshairs")
                          .name("Show Crosshairs")
                          .onChange(@setDisplayCrosshair)
    (fView.add @settings, "interpolation")
                          .name("Interpolation")
                          .onChange(@setInterpolation)
    (fView.add @settings, "minZoomStep", [0, 1, 2, 3])
                          .name("Min. Zoom Level")
                          .onChange(@setMinZoomStep)

    fSkeleton = @gui.addFolder("Skeleton View")
    (fSkeleton.add @settings, "displayPrevXY")
                          .name("Display XY-Plane")
                          .onChange(@setDisplayPreviewXY)
    (fSkeleton.add @settings, "displayPrevYZ")
                          .name("Display YZ-Plane")
                          .onChange(@setDisplayPreviewYZ)
    (fSkeleton.add @settings, "displayPrevXZ")
                          .name("Display XZ-Plane")
                          .onChange(@setDisplayPreviewXZ)
    (fSkeleton.add @settings, "nodesAsSpheres")
                          .name("Nodes as Spheres")
                          .onChange(@setNodeAsSpheres)

    fTrees = @gui.addFolder("Trees")
    @activeTreeIdController =
    (fTrees.add @settings, "activeTreeID")
                          .min(1)
                          .step(1)
                          .name("Active Tree ID")
                          .onFinishChange( (value) => @trigger "setActiveTree", value)
    (fTrees.add @settings, "newNodeNewTree")
                          .name("Soma clicking mode")
                          .onChange(@setNewNodeNewTree)
    (fTrees.add @settings, "newTree")
                          .name("Create New Tree")
    (fTrees.add @settings, "deleteActiveTree")
                          .name("Delete Active Tree")

    fNodes = @gui.addFolder("Nodes")
    @activeNodeIdController =
    (fNodes.add @settings, "activeNodeID")
                          .min(1)
                          .step(1)
                          .name("Active Node ID")
                          .onFinishChange( (value) => @trigger "setActiveNode", value)
    (fNodes.add @settings, "radius", 1 * scale , 1000 * scale)
                          .name("Radius")    
                          .listen()
                          .onChange(@setNodeRadius)
    (fNodes.add @settings, "deleteActiveNode")
                          .name("Delete Active Node")

    #fControls.open()
    #fView.open()
    #fSkeleton.open()
    fTrees.open()
    fNodes.open()

    @flycam.on "globalPositionChanged", (position) => 

      @updateGlobalPosition(position)
      return

    $("#trace-position-input").on "change", (event) => 

      @setPosFromString(event.target.value)
      return

    @model.route.on("newActiveNode", =>
      @update())

    @model.route.on("newActiveTree", =>
      @update())

    @model.route.on("deleteActiveTree", =>
      @update())

    @model.route.on("deleteActiveNode", =>
      @update())

    @model.route.on("newNode", =>
      @update())

    @model.route.on("newActiveNodeRadius", (radius) =>
      @updateRadius(radius))

  saveNow : =>
    @model.user.pushImpl()
    @model.route.pushImpl()
      .then( 
        -> Toast.success("Saved!")
        -> Toast.error("Couldn't save. Please try again.")
      )

  setPosFromString : (posString) =>
    stringArray = posString.split(",")
    if stringArray.length == 3
      pos = [parseInt(stringArray[0]), parseInt(stringArray[1]), parseInt(stringArray[2])]
      if !isNaN(pos[0]) and !isNaN(pos[1]) and !isNaN(pos[2])
        @flycam.setGlobalPos(pos)
        return
    @updateGlobalPosition(@flycam.getGlobalPos())

  updateGlobalPosition : (globalPos) =>
    stringPos = Math.round(globalPos[0]) + ", " + Math.round(globalPos[1]) + ", " + Math.round(globalPos[2])
    $("#trace-position-input").val(stringPos)

  setMoveValue : (value) =>
    @model.user.moveValue = (Number) value
    @model.user.push()

  setRouteClippingDistance : (value) =>
    @model.user.routeClippingDistance = (Number) value
    @cameraController.setRouteClippingDistance((Number) value)
    @sceneController.setRouteClippingDistance((Number) value)
    @model.user.push()   

  setLockZoom : (value) =>
    @model.user.lockZoom = value
    @model.user.push()      

  setDisplayCrosshair : (value) =>
    @model.user.displayCrosshair = value
    @sceneController.setDisplayCrosshair(value)
    @model.user.push()    

  setInterpolation : (value) =>
    @sceneController.setInterpolation(value)
    @model.user.interpolation = (Boolean) value
    @model.user.push()

  setMinZoomStep : (value) =>
    value = parseInt(value)
    @flycam.setOverrideZoomStep(value)
    @model.user.minZoomStep = (Number) value
    @model.user.push()

  setDisplayPreviewXY : (value) =>
    @model.user.displayPreviewXY = value
    @sceneController.setDisplaySV PLANE_XY, value
    @model.user.push()      

  setDisplayPreviewYZ : (value) =>
    @model.user.displayPreviewYZ = value
    @sceneController.setDisplaySV PLANE_YZ, value
    @model.user.push()      

  setDisplayPreviewXZ : (value) =>
    @model.user.displayPreviewXZ = value
    @sceneController.setDisplaySV PLANE_XZ, value
    @model.user.push()      

  setNodeAsSpheres : (value) =>
    @model.user.nodesAsSpheres = value
    @sceneController.skeleton.setDisplaySpheres(value)
    @model.user.push()  
    @flycam.hasChanged = true    

  setMouseInversionX : (value) =>
    if value is true
      @model.user.mouseInversionX = 1
    else
      @model.user.mouseInversionX = -1
    @model.user.push()         

  setMouseInversionY : (value) =>
    if value is true
      @model.user.mouseInversionY = 1
    else
      @model.user.mouseInversionY = -1
    @model.user.push()

  setNewNodeNewTree : (value) =>
    @model.user.newNodeNewTree = value
    @model.user.push()      

  setNodeRadius : (value) =>
    @model.route.setActiveNodeRadius(value)

  updateRadius : (value) ->
    if value then @settings.radius = value
    else if (value = @model.route.getActiveNodeRadius())
      @settings.radius = value

  # called when value user switch to different active node
  updateNodeAndTreeIds : =>
    @settings.activeNodeID = @model.route.lastActiveNodeId
    @settings.activeTreeID = @model.route.getActiveTreeId()
    @activeNodeIdController.updateDisplay()
    @activeTreeIdController.updateDisplay()

  # Helper method to combine common update methods
  update : ->
    @updateNodeAndTreeIds()
    @updateRadius()
