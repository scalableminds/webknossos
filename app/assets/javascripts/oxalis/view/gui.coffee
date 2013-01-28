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
VIEWPORT_WIDTH     = 380

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
    @qualityArray = ["high", "medium", "low"]

    @datasetPostfix = _.last(@model.binary.dataSetName.split("_"))
    @datasetPosition = @initDatasetPosition(data.briConNames)
    
    @settings = 

      rotateValue : data.rotateValue
      moveValue3d : data.moveValue3d
      mouseRotateValue : data.mouseRotateValue
      crosshairSize : data.crosshairSize
      
      lockZoom: data.lockZoom
      inverseX: data.mouseInversionX == 1
      inverseY: data.mouseInversionY == 1

      moveValue : data.moveValue
      routeClippingDistance: data.routeClippingDistance
      displayCrosshairs: data.displayCrosshair

      fourBit : data.fourBit
      briConNames : data.briConNames
      brightness : data.brightness[@datasetPosition]
      contrast : data.contrast[@datasetPosition]
      resetBrightnessAndContrast : => @resetBrightnessAndContrast()
      interpolation : data.interpolation
      quality : @qualityArray[data.quality]

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
      comment : ""
      prevComment : @prevComment
      nextComment : @nextComment

    if @datasetPosition == 0
      # add new dataset to settings
      @model.user.briConNames.push(@datasetPostfix)
      @model.user.brightness.push(@settings.brightness)
      @model.user.contrast.push(@settings.contrast)
      @dataSetPosition = data.briConNames.length - 1


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

    fFlightcontrols = @gui.addFolder("Flighcontrols")
    (fFlightcontrols.add @settings, "mouseRotateValue", 0.001, 0.02)
                          .step(0.001)
                          .name("Mouse Rotation")
                          .onChange(@setMouseRotateValue)
    (fFlightcontrols.add @settings, "rotateValue", 0.001, 0.08)
                          .step(0.001)
                          .name("Keyboard Rotation Value")
                          .onChange(@setRotateValue)
    (fFlightcontrols.add @settings, "moveValue3d", 0.1, 10) 
                          .step(0.1)
                          .name("Move Value")    
                          .onChange(@setMoveValue3d)
    (fFlightcontrols.add @settings, "crosshairSize", 0.1, 1) 
                          .step(0.1)
                          .name("Crosshair size")    
                          .onChange(@setCrosshairSize)                          


    fView = @gui.addFolder("Planes")
    (fView.add @settings, "moveValue", 0.1, 10) 
                          .step(0.1)
                          .name("Move Value")    
                          .onChange(@setMoveValue)
    scale = @model.scaleInfo.baseVoxel
    (fView.add @settings, "routeClippingDistance", 1, 1000 * scale)
                          .name("Clipping Distance")    
                          .onChange(@setRouteClippingDistance)
    (fView.add @settings, "displayCrosshairs")
                          .name("Show Crosshairs")
                          .onChange(@setDisplayCrosshair)

    fView = @gui.addFolder("Voxel")
    (fView.add @settings, "fourBit")
                          .name("4 Bit")
                          .onChange(@set4Bit)
    @brightnessController =
    (fView.add @settings, "brightness", -256, 256) 
                          .step(5)
                          .name("Brightness")    
                          .onChange(@setBrightnessAndContrast)
    @contrastController =
    (fView.add @settings, "contrast", 0.5, 5) 
                          .step(0.1)
                          .name("Contrast")    
                          .onChange(@setBrightnessAndContrast)
    (fView.add @settings, "resetBrightnessAndContrast")
                          .name("Reset To Default")
    (fView.add @settings, "interpolation")
                          .name("Interpolation")
                          .onChange(@setInterpolation)
    (fView.add @settings, "quality", @qualityArray)
                          .name("Quality")
                          .onChange(@setQuality)

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
    # (fSkeleton.add @settings, "nodesAsSpheres")
    #                       .name("Nodes as Spheres")
    #                       .onChange(@setNodeAsSpheres)

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
    # (fNodes.add @settings, "radius", 1 * scale , 1000 * scale)
    #                       .name("Radius")    
    #                       .listen()
    #                       .onChange(@setNodeRadius)
    @commentController =
    (fNodes.add @settings, "comment")
                          .name("Comment")
                          .onChange(@setComment)
    (fNodes.add @settings, "prevComment")
                          .name("Previous Comment")
    (fNodes.add @settings, "nextComment")
                          .name("Next Comment")
    (fNodes.add @settings, "deleteActiveNode")
                          .name("Delete Active Node")

    #fControls.open()
    #fView.open()
    #fSkeleton.open()
    fTrees.open()
    fNodes.open()

    $("#trace-position-input").on "change", (event) => 

      @setPosFromString(event.target.value)
      return

    @flycam.on
                globalPositionChanged : (position) => 
                  @updateGlobalPosition(position)
                zoomFactorChanged : (factor, step) =>
                  nm = factor * VIEWPORT_WIDTH * @model.scaleInfo.baseVoxel
                  if(nm<1000)
                    $("#zoomFactor").html("<p>Viewport width: " + nm.toFixed(0) + " nm</p>")
                  else if (nm<1000000)
                    $("#zoomFactor").html("<p>Viewport width: " + (nm / 1000).toFixed(1) + " μm</p>")
                  else
                    $("#zoomFactor").html("<p>Viewport width: " + (nm / 1000000).toFixed(1) + " mm</p>")

    @model.route.on  
                      newActiveNode    : => @update()
                      newActiveTree    : => @update()
                      deleteActiveTree : => @update()
                      deleteActiveNode : => @update()
                      deleteLastNode   : => @update()
                      newNode          : => @update()
                      newTree          : => @update()
                      # newActiveNodeRadius : (radius) =>@updateRadius(radius) 
                      pushFailed       : -> Toast.error("Auto-Save failed!")

    @createTooltips()

  saveNow : =>
    @model.user.pushImpl()
    @model.route.pushNow()
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

  initDatasetPosition : (briConNames) ->

    for i in [0...briConNames.length]
      if briConNames[i] == @datasetPostfix
        datasetPosition = i
    unless datasetPosition
      # take default values
      datasetPosition = 0
    datasetPosition

  createTooltips : ->
      $(".cr.number.has-slider").tooltip({"title" : "Move mouse up or down while clicking the number to easily adjust the value"})

  updateGlobalPosition : (globalPos) =>
    stringPos = Math.round(globalPos[0]) + ", " + Math.round(globalPos[1]) + ", " + Math.round(globalPos[2])
    $("#trace-position-input").val(stringPos)

  setMouseRotateValue : (value) =>
    @model.user.mouseRotateValue = (Number) value
    @model.user.push()

  setRotateValue : (value) =>
    @model.user.rotateValue = (Number) value
    @model.user.push()    

  setMoveValue : (value) =>
    @model.user.moveValue = (Number) value
    @model.user.push()

  setMoveValue3d : (value) =>
    @model.user.moveValue3d = (Number) value
    @model.user.push()    

  setCrosshairSize : (value) =>
    @model.user.setValue("crosshairSize", (Number) value)
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

  set4Bit : (value) =>
    @model.binary.queue.set4Bit(value)
    @model.user.fourBit = (Boolean) value
    @model.user.push()

  setBrightnessAndContrast : =>
    @model.binary.updateLookupTable(@settings.brightness, @settings.contrast)
    @model.user.brightness[@datasetPosition] = (Number) @settings.brightness
    @model.user.contrast[@datasetPosition] = (Number) @settings.contrast
    @model.user.push()

  resetBrightnessAndContrast : =>
    Request.send(
      url : "/user/configuration/default"
      dataType : "json"
    ).done (defaultData) =>
      defaultDatasetPosition = @initDatasetPosition(defaultData.briConNames)

      @settings.brightness = defaultData.brightness[defaultDatasetPosition]
      @settings.contrast = defaultData.contrast[defaultDatasetPosition]
      @setBrightnessAndContrast()
      @brightnessController.updateDisplay()
      @contrastController.updateDisplay()


  setQuality : (value) =>
    for i in [0..(@qualityArray.length - 1)]
      if @qualityArray[i] == value
        value = i
    @flycam.setQuality(value)
    @model.user.quality = (Number) value
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

  # setNodeAsSpheres : (value) =>
  #   @model.user.nodesAsSpheres = value
  #   @sceneController.skeleton.setDisplaySpheres(value)
  #   @model.user.push()  
  #   @flycam.hasChanged = true    

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

  # setNodeRadius : (value) =>
  #   @model.route.setActiveNodeRadius(value)

  setComment : (value) =>
    @model.route.setComment(value)

  prevComment : =>
    @trigger "setActiveNode", @model.route.nextCommentNodeID(false)

  nextComment : =>
    @trigger "setActiveNode", @model.route.nextCommentNodeID(true)

  # updateRadius : (value) ->
  #   if value then @settings.radius = value
  #   else if (value = @model.route.getActiveNodeRadius())
  #     @settings.radius = value

  # Helper method to combine common update methods
  update : ->
    # called when value user switch to different active node
    @settings.activeNodeID = @model.route.lastActiveNodeId
    @settings.activeTreeID = @model.route.getActiveTreeId()
    @settings.comment      = @model.route.getComment()
    @activeNodeIdController.updateDisplay()
    @activeTreeIdController.updateDisplay()
    @commentController.updateDisplay()

    # @updateRadius()
