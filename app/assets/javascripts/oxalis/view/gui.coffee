### define
../../libs/datgui/dat.gui : DatGui
../../libs/request : Request
../../libs/event_mixin : EventMixin
../../libs/toast : Toast
../model/dimensions : Dimensions
###

PLANE_XY           = Dimensions.PLANE_XY
PLANE_YZ           = Dimensions.PLANE_YZ
PLANE_XZ           = Dimensions.PLANE_XZ
VIEW_3D            = Dimensions.VIEW_3D
VIEWPORT_WIDTH     = 380

class Gui 

  model : null
  
  constructor : (container, @model, settings) ->
    
    _.extend(this, new EventMixin())

    @user = @model.user
    # create GUI
    modelRadius = @model.route.getActiveNodeRadius()
    @qualityArray = ["high", "medium", "low"]

    @datasetPostfix = _.last(@model.binary.dataSetName.split("_"))
    @datasetPosition = @initDatasetPosition(@user.briConNames)

    somaClickingAllowed = settings.somaClickingAllowed
    
    @settings = 

      fourBit : @user.fourBit
      brightness : @user.brightness[@datasetPosition]
      contrast : @user.contrast[@datasetPosition]
      resetBrightnessAndContrast : => @resetBrightnessAndContrast()
      quality : @qualityArray[@user.quality]

      activeTreeID : @model.route.getActiveTreeId()
      newTree : => @trigger "createNewTree"
      deleteActiveTree : => @trigger "deleteActiveTree"

      activeNodeID : @model.route.getActiveNodeId()
      newNodeNewTree : if somaClickingAllowed then @user.newNodeNewTree else false
      deleteActiveNode : => @trigger "deleteActiveNode"
      radius : if modelRadius then modelRadius else 10 * @model.scaleInfo.baseVoxel
      comment : ""
      prevComment : @prevComment
      nextComment : @nextComment

    if @datasetPosition == 0
      # add new dataset to settings
      @user.briConNames.push(@datasetPostfix)
      @user.brightness.push(@settings.brightness)
      @user.contrast.push(@settings.contrast)
      @datasetPosition = @user.briConNames.length - 1


    @gui = new dat.GUI(autoPlace: false, width : 280, hideable : false, closed : true)

    container.append @gui.domElement
    
    fControls = @gui.addFolder("Controls")
    @addCheckbox(fControls, @user, "lockZoom", "Lock Zoom")
    @addCheckbox(fControls, @user, "inverseX", "Inverse X")
    @addCheckbox(fControls, @user, "inverseY", "Inverse Y")
    @addCheckbox(fControls, @user, "dynamicSpaceDirection", "d/f-Switching")

    fFlightcontrols = @gui.addFolder("Flighcontrols")
    @addSlider(fFlightcontrols, @user, "mouseRotateValue",
      0.001, 0.02, 0.001, "Mouse Rotation")
    @addSlider(fFlightcontrols, @user, "rotateValue",
      0.001, 0.08, 0.001, "Keyboard Rotation Value")
    @addSlider(fFlightcontrols, @user, "moveValue3d",
      0.1, 10, 0.1, "Move Value")
    @addSlider(fFlightcontrols, @user, "crosshairSize",
      0.1, 1, 0.01, "Crosshair size")

    fPlanes = @gui.addFolder("Planes")
    @addSlider(fPlanes, @user, "moveValue",
      0.1, 10, 0.1, "Move Value")
    @addSlider(fPlanes, @user, "routeClippingDistance",
      1, 1000 * @model.scaleInfo.baseVoxel, 1, "Clipping Distance")
    @addCheckbox(fPlanes, @user, "displayCrosshair", "Show Crosshairs")

    fVoxel = @gui.addFolder("Voxel")
    @addCheckbox(fVoxel, @settings, "fourBit", "4 Bit")
    @brightnessController =
      @addSlider(fVoxel, @settings, "brightness",
        -256, 256, 5, "Brightness", @setBrightnessAndContrast)
    @contrastController =
      @addSlider(fVoxel, @settings, "contrast",
        0.5, 5, 0.1, "Contrast", @setBrightnessAndContrast)
    @addFunction(fVoxel, @settings, "resetBrightnessAndContrast",
      "Reset To Default")
    @addCheckbox(fVoxel, @user, "interpolation", "Interpolation")
    (fVoxel.add @settings, "quality", @qualityArray)
                          .name("Quality")
                          .onChange((v) => @setQuality(v))

    fSkeleton = @gui.addFolder("Skeleton View")
    @addCheckbox(fSkeleton, @user, "displayPreviewXY", "Display XY-Plane")
    @addCheckbox(fSkeleton, @user, "displayPreviewYZ", "Display YZ-Plane")
    @addCheckbox(fSkeleton, @user, "displayPreviewXZ", "Display XZ-Plane")

    fTrees = @gui.addFolder("Trees")
    @activeTreeIdController = @addNumber(fTrees, @settings, "activeTreeID",
      1, 1, "Active Tree ID")
    if somaClickingAllowed
      @addCheckbox(fTrees, @settings, "newNodeNewTree", "Soma clicking mode")
    else
      @setNewNodeNewTree(false)
    @addFunction(fTrees, @settings, "newTree", "Create New Tree")
    @addFunction(fTrees, @settings, "deleteActiveTree", "Delete Active Tree")

    fNodes = @gui.addFolder("Nodes")
    @activeNodeIdController = @addNumber(fNodes, @settings, "activeNodeID",
      1, 1, "Active Node ID")
    @commentController =
    (fNodes.add @settings, "comment")
                          .name("Comment")
                          .onChange(@setComment)
    @addFunction(fNodes, @settings, "prevComment", "Previous Comment")
    @addFunction(fNodes, @settings, "nextComment", "Next Comment")
    @addFunction(fNodes, @settings, "deleteActiveNode", "Delete Active Node")

    #fControls.open()
    #fView.open()
    #fSkeleton.open()
    fTrees.open()
    fNodes.open()

    $("#trace-position-input").on "change", (event) => 

      @setPosFromString(event.target.value)
      return

    $("#trace-finish-button").click (event) =>

      event.preventDefault()
      @saveNow().done =>
        if confirm("Are you sure?")
          window.location.href = event.srcElement.href

    $("#trace-download-button").click (event) =>

      event.preventDefault()
      @saveNow().done =>
          window.location.href = event.srcElement.href

    $("#trace-save-button").click (event) =>

      event.preventDefault()
      @saveNow()


    @model.flycam.on
      positionChanged : (position) => 
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


  addCheckbox : (folder, object, propertyName, displayName) =>
    return (folder.add object, propertyName)
                          .name(displayName)
                          .onChange((v) => @set(propertyName, v,  Boolean))

  addSlider : (folder, object, propertyName, start, end, step, displayName, onChange) =>
    unless onChange?
      onChange = (v) => @set(propertyName, v, Number)
    return (folder.add object, propertyName, start, end)
                          .step(step)
                          .name(displayName)
                          .onChange(onChange)

  addFunction : (folder, object, propertyName, displayName) =>
    return (folder.add object, propertyName)
                          .name(displayName)

  addNumber : (folder, object, propertyName, min, step, displayName) =>
    return (folder.add object, propertyName)
                          .min(min)
                          .step(step)
                          .name(displayName)
                          .onChange((v) => @set(propertyName, v, Number))

  saveNow : =>
    @user.pushImpl()
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
        @model.flycam.setPosition(pos)
        return
    @updateGlobalPosition(@model.flycam.getPosition())

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

  set : (name, value, type) =>
    @user.setValue( name, (type) value)

  setBrightnessAndContrast : =>
    @model.binary.updateLookupTable(@settings.brightness, @settings.contrast)
    @user.brightness[@datasetPosition] = (Number) @settings.brightness
    @user.contrast[@datasetPosition] = (Number) @settings.contrast
    @user.push()

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
    @set("quality", value, Number)

  setComment : (value) =>
    @model.route.setComment(value)

  prevComment : =>
    @trigger "setActiveNode", @model.route.nextCommentNodeID(false)

  nextComment : =>
    @trigger "setActiveNode", @model.route.nextCommentNodeID(true)

  # Helper method to combine common update methods
  update : ->
    # called when value user switch to different active node
    @settings.activeNodeID = @model.route.lastActiveNodeId
    @settings.activeTreeID = @model.route.getActiveTreeId()
    @settings.comment      = @model.route.getComment()
    @activeNodeIdController.updateDisplay()
    @activeTreeIdController.updateDisplay()
    @commentController.updateDisplay()
