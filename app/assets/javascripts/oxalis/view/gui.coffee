### define
../../libs/datgui/dat.gui : DatGui
../../libs/request : Request
../../libs/event_mixin : EventMixin
../../libs/toast : Toast
../model/dimensions : Dimensions
../constants : constants
###

class Gui 

  model : null
  
  constructor : (container, @model, @restrictions, @tracingSettings) ->
    
    _.extend(this, new EventMixin())

    @user = @model.user
    # create GUI
    # modelRadius = @model.route.getActiveNodeRadius()
    @qualityArray = ["high", "medium", "low"]

    @datasetPostfix = _.last(@model.binary.dataSetName.split("_"))
    @datasetPosition = @initDatasetPosition(@user.briConNames)

    somaClickingAllowed = @tracingSettings.somaClickingAllowed
    
    @settings = 

      fourBit : @user.fourBit
      brightness : @user.brightness[@datasetPosition]
      contrast : @user.contrast[@datasetPosition]
      resetBrightnessAndContrast : => @resetBrightnessAndContrast()
      quality : @qualityArray[@user.quality]

      activeTreeID : @model.route.getActiveTreeId()

      activeNodeID : @model.route.getActiveNodeId()
      activeCellID : @model.volumeTracing.getActiveCellId()
      newNodeNewTree : if somaClickingAllowed then @user.newNodeNewTree else false
      deleteActiveNode : => @trigger "deleteActiveNode"
      createNewCell : => @trigger "createNewCell"
      # radius : if modelRadius then modelRadius else 10 * @model.scaleInfo.baseVoxel

    if @datasetPosition == 0
      # add new dataset to settings
      @user.briConNames.push(@datasetPostfix)
      @user.brightness.push(@settings.brightness)
      @user.contrast.push(@settings.contrast)
      @datasetPosition = @user.briConNames.length - 1


    @gui = new dat.GUI(autoPlace: false, width : 280, hideable : false, closed : true)

    container.append @gui.domElement

    @folders = []
    
    @folders.push( fControls = @gui.addFolder("Controls") )
    @addCheckbox(fControls, @user, "inverseX", "Inverse X")
    @addCheckbox(fControls, @user, "inverseY", "Inverse Y")
    @addSlider(fControls, @user, "keyboardDelay",
      0, 500, 10, "Keyboard delay (ms)" )

    @folders.push( @fViewportcontrols = @gui.addFolder("Viewportoptions") )
    @moveValueController = @addSlider(@fViewportcontrols, @user, "moveValue",
      constants.MIN_MOVE_VALUE, constants.MAX_MOVE_VALUE, 10, "Move Value (nm/s)")
    @zoomController = @addSlider(@fViewportcontrols, @user, "zoom",
      0.01, @model.flycam.getMaxZoomStep(), 0.001, "Zoom")
    @scaleController = @addSlider(@fViewportcontrols, @user, "scale", constants.MIN_SCALE,
      constants.MAX_SCALE, 0.1, "Viewport Scale")
    @addCheckbox(@fViewportcontrols, @user, "dynamicSpaceDirection", "d/f-Switching")

    @folders.push( @fFlightcontrols = @gui.addFolder("Flightoptions") )
    @addSlider(@fFlightcontrols, @user, "mouseRotateValue",
      0.001, 0.02, 0.001, "Mouse Rotation")
    @addSlider(@fFlightcontrols, @user, "rotateValue",
      0.001, 0.08, 0.001, "Keyboard Rotation Value")
    @moveValue3dController = @addSlider(@fFlightcontrols, @user, "moveValue3d",
      constants.MIN_MOVE_VALUE, constants.MAX_MOVE_VALUE, 10, "Move Value (nm/s)")
    @addSlider(@fFlightcontrols, @user, "crosshairSize",
      0.05, 0.5, 0.01, "Crosshair size")

    @folders.push( @fView = @gui.addFolder("View") )
    @addCheckbox(@fView, @settings, "fourBit", "4 Bit")
    @addCheckbox(@fView, @user, "interpolation", "Interpolation")
    @brightnessController =
      @addSlider(@fView, @settings, "brightness",
        -256, 256, 5, "Brightness", @setBrightnessAndContrast)
    @contrastController =
      @addSlider(@fView, @settings, "contrast",
        0.5, 5, 0.1, "Contrast", @setBrightnessAndContrast)
    @addFunction(@fView, @settings, "resetBrightnessAndContrast",
      "Reset B/C")
    @clippingController = @addSlider(@fView, @user, "routeClippingDistance",
      1, 1000 * @model.scaleInfo.baseVoxel, 1, "Clipping Distance")
    @clippingControllerArbitrary = @addSlider(@fView, @user, "routeClippingDistanceArbitrary",
      1, 127, 1, "Clipping Distance")
    @addCheckbox(@fView, @user, "displayCrosshair", "Show Crosshairs")
    (@fView.add @settings, "quality", @qualityArray)
                          .name("Quality")
                          .onChange((v) => @setQuality(v))

    @folders.push( @fSkeleton = @gui.addFolder("Skeleton View") )
    @addCheckbox(@fSkeleton, @user, "displayPreviewXY", "Display XY-Plane")
    @addCheckbox(@fSkeleton, @user, "displayPreviewYZ", "Display YZ-Plane")
    @addCheckbox(@fSkeleton, @user, "displayPreviewXZ", "Display XZ-Plane")

    @folders.push( @fTrees = @gui.addFolder("Trees") )
    @activeTreeIdController = @addNumber(@fTrees, @settings, "activeTreeID",
      1, 1, "Active Tree ID", (value) => @trigger( "setActiveTree", value))
    if somaClickingAllowed
      @addCheckbox(@fTrees, @settings, "newNodeNewTree", "Soma clicking mode")
    else
      @set("newNodeNewTree", false, Boolean)

    @folders.push( @fNodes = @gui.addFolder("Nodes") )
    @activeNodeIdController = @addNumber(@fNodes, @settings, "activeNodeID",
      1, 1, "Active Node ID", (value) => @trigger( "setActiveNode", value))
    @particleSizeController = @addSlider(@fNodes, @user, "particleSize",
      constants.MIN_PARTICLE_SIZE, constants.MAX_PARTICLE_SIZE, 1, "Node size")
    @addFunction(@fNodes, @settings, "deleteActiveNode", "Delete Active Node")

    @folders.push( @fCells = @gui.addFolder("Cells") )
    @activeCellIdController = @addNumber(@fCells, @settings, "activeCellID",
      0, 1, "Active Cell ID", (value) => @trigger( "setActiveCell", value))
    @addFunction(@fCells, @settings, "createNewCell", "Create new Cell")

    @fTrees.open()
    @fNodes.open()
    @fCells.open()

    $("#dataset-name").text(@model.binary.dataSetName)

    $("#trace-position-input").on "change", (event) => 

      @setPosFromString(event.target.value)
      $("#trace-position-input").blur()

    $("#trace-finish-button").click (event) =>

      event.preventDefault()
      @saveNow().done =>
        if confirm("Are you sure you want to permanently finish this tracing?")
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

    @model.user.on
      zoomChanged : (zoom) =>
        nm = zoom * constants.VIEWPORT_WIDTH * @model.scaleInfo.baseVoxel
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

    @model.volumeTracing.on
      newActiveCell    : =>
        console.log "newActiveCell!"
        @update()

    @model.user.on
      scaleChanged : => @updateScale()
      zoomChanged : => @updateZoom()
      moveValueChanged : => @updateMoveValue()
      moveValue3dChanged : => @updateMoveValue3d()
      particleSizeChanged : => @updateParticleSize()

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


  addNumber : (folder, object, propertyName, min, step, displayName, onChange) =>

    unless onChange?
      onChange = (v) => @set(propertyName, v, Number)
    return (folder.add object, propertyName)
                          .min(min)
                          .step(step)
                          .name(displayName)
                          .onChange(onChange)


  saveNow : =>

    @user.pushImpl()
    if @restrictions.allowUpdate
      @model.route.pushNow()
        .then( 
          -> Toast.success("Saved!")
          -> Toast.error("Couldn't save. Please try again.")
        )
    else
      new $.Deferred().resolve()


  setPosFromString : (posString) =>

    # remove leading/trailing whitespaces
    strippedString = posString.trim()
    # replace remaining whitespaces with commata
    unifiedString = strippedString.replace /,?\s+,?/g, ","
    stringArray = unifiedString.split(",")
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

    stringPos = Math.floor(globalPos[0]) + ", " + Math.floor(globalPos[1]) + ", " + Math.floor(globalPos[2])
    $("#trace-position-input").val(stringPos)


  set : (name, value, type) =>

    @user.setValue( name, (type) value)


  setBrightnessAndContrast : =>

    @model.binary.updateContrastCurve(@settings.brightness, @settings.contrast)
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


  updateParticleSize : =>

    @particleSizeController.updateDisplay()


  updateMoveValue : =>

    @moveValueController.updateDisplay()


  updateMoveValue3d : =>

    @moveValue3dController.updateDisplay()


  updateScale : =>

    @scaleController.updateDisplay()


  updateZoom : =>

    @zoomController.updateDisplay()


  update : ->

    # Helper method to combine common update methods
    # called when value user switch to different active node
    @settings.activeNodeID = @model.route.lastActiveNodeId
    @settings.activeTreeID = @model.route.getActiveTreeId()
    @settings.activeCellID = @model.volumeTracing.getActiveCellId()
    @activeNodeIdController.updateDisplay()
    @activeTreeIdController.updateDisplay()
    @activeCellIdController.updateDisplay()


  setFolderVisibility : (folder, visible) ->

    $element = $(folder.domElement)
    if visible then $element.show() else $element.hide()


  setFolderElementVisibility : (element, visible) ->

    $element = $(element.domElement).parents(".cr")
    if visible then $element.show() else $element.hide()


  hideFolders : (folders) ->

    for folder in folders
      @setFolderVisibility( folder, false)


  setMode : (mode) ->

    for folder in @folders
      @setFolderVisibility(folder, true)
    @setFolderElementVisibility( @clippingControllerArbitrary, false )
    @setFolderElementVisibility( @clippingController, true )

    switch mode 
      when constants.MODE_PLANE_TRACING
        @hideFolders( [ @fFlightcontrols ] )
        @user.triggerAll()
      when constants.MODE_ARBITRARY
        @hideFolders( [ @fViewportcontrols, @fSkeleton ] )
        @setFolderElementVisibility( @clippingControllerArbitrary, true )
        @setFolderElementVisibility( @clippingController, false )
        @user.triggerAll()
      when constants.MODE_VOLUME
        @hideFolders( [ @fTrees, @fNodes, @fFlightcontrols ] )

