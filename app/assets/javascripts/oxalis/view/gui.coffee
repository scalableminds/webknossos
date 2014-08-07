### define
dat.gui : DatGui
libs/request : Request
libs/event_mixin : EventMixin
libs/toast : Toast
../model/dimensions : Dimensions
../constants : constants
../controller/viewmodes/arbitrary_controller : ArbitraryController
###

class Gui

  model : null

  constructor : (container, @model, @restrictions, @tracingSettings) ->

    _.extend(this, new EventMixin())

    @updateGlobalPosition( @model.flycam.getPosition() )
    @updateRotation()
    @mode == constants.MODE_PLANE_TRACING

    @user = @model.user
    @qualityArray = ["high", "medium", "low"]

    @brightnessContrastSettings = @user.getOrCreateBrightnessContrastSettings(
      @model.datasetPostfix
    )

    somaClickingAllowed = @tracingSettings.somaClickingAllowed

    @settingsGeneral =

      boundingBox : "0, 0, 0, 0, 0, 0"
      fourBit : @user.get("fourBit")
      brightness : @brightnessContrastSettings.brightness
      contrast : @brightnessContrastSettings.contrast
      resetColorSettings : => @resetColorSettings()
      quality : @qualityArray[@user.get("quality")]

    @setupColors()

    if @model.skeletonTracing?
      @settingsSkeleton =
        activeTreeID : @model.skeletonTracing.getActiveTreeId()
        activeNodeID : @model.skeletonTracing.getActiveNodeId() or -1
        newNodeNewTree : if somaClickingAllowed then @user.get("newNodeNewTree") else false
        radius : @model.skeletonTracing.getActiveNodeRadius()
        deleteActiveNode : => @trigger "deleteActiveNode"

    if @model.volumeTracing
      @settingsVolume =
        activeCellID : @model.volumeTracing.getActiveCellId()
        createNewCell : => @trigger "createNewCell"


    @gui = new dat.GUI(autoPlace: false, width : 280, hideable : false, closed : true)

    container.append @gui.domElement

    @folders = []

    @folders.push( fControls = @gui.addFolder("Controls") )
    @addCheckbox(fControls, @user.getSettings(), "inverseX", "Inverse X")
    @addCheckbox(fControls, @user.getSettings(), "inverseY", "Inverse Y")
    @addSlider(fControls, @user.getSettings(), "keyboardDelay",
      0, 500, 10, "Keyboard delay (ms)" )

    @folders.push( @fViewportcontrols = @gui.addFolder("Viewportoptions") )
    @moveValueController = @addSlider(@fViewportcontrols, @user.getSettings(), "moveValue",
      constants.MIN_MOVE_VALUE, constants.MAX_MOVE_VALUE, 10, "Move Value (nm/s)")
    @zoomController = @addSlider(@fViewportcontrols, @user.getSettings(), "zoom",
      0.01, @model.flycam.getMaxZoomStep(), 0.001, "Zoom")
    @scaleController = @addSlider(@fViewportcontrols, @user.getSettings(), "scale", constants.MIN_SCALE,
      constants.MAX_SCALE, 0.1, "Viewport Scale")
    @addCheckbox(@fViewportcontrols, @user.getSettings(), "dynamicSpaceDirection", "d/f-Switching")

    @folders.push( @fFlightcontrols = @gui.addFolder("Flightoptions") )
    @addSlider(@fFlightcontrols, @user.getSettings(), "mouseRotateValue",
      0.001, 0.02, 0.001, "Mouse Rotation")
    @addSlider(@fFlightcontrols, @user.getSettings(), "rotateValue",
      0.001, 0.08, 0.001, "Keyboard Rotation Value")
    @moveValue3dController = @addSlider(@fFlightcontrols, @user.getSettings(), "moveValue3d",
      constants.MIN_MOVE_VALUE, constants.MAX_MOVE_VALUE, 10, "Move Value (nm/s)")
    @addSlider(@fFlightcontrols, @user.getSettings(), "crosshairSize",
      0.05, 0.5, 0.01, "Crosshair size")
    @addSlider(@fFlightcontrols, @user.getSettings(), "sphericalCapRadius",
      50, 500, 1, "Sphere Radius")

    @folders.push( @fColors = @gui.addFolder("Colors") )
    @segmentationOpacityController =
      @addSlider(@fColors, @user.getSettings(), "segmentationOpacity",
        0, 100, 1, "Segment. Opacity")
    @colorControllers = []
    for binary, i in @model.getColorBinaries()
      @colorControllers.push(
        @addColorPicker(@fColors, @settingsGeneral, binary.name + "_color", "Color " + (i+1),
          @setColorSettings)
      )
    @brightnessController =
      @addSlider(@fColors, @settingsGeneral, "brightness",
        -256, 256, 5, "Brightness", @setColorSettings)
    @contrastController =
      @addSlider(@fColors, @settingsGeneral, "contrast",
        0.5, 5, 0.1, "Contrast", @setColorSettings)
    @addFunction(@fColors, @settingsGeneral, "resetColorSettings",
      "Reset")

    @folders.push( @fView = @gui.addFolder("View") )
    bbController = @fView.add(@settingsGeneral, "boundingBox").name("Bounding Box").onChange(@setBoundingBox)
    @addTooltip(bbController, "Format: minX, minY, minZ, maxX, maxY, maxZ")
    @addCheckbox(@fView, @settingsGeneral, "fourBit", "4 Bit")
    @addCheckbox(@fView, @user.getSettings(), "interpolation", "Interpolation")
    @clippingController = @addSlider(@fView, @user.getSettings(), "clippingDistance",
      1, 1000 * @model.scaleInfo.baseVoxel, 1, "Clipping Distance")
    @clippingControllerArbitrary = @addSlider(@fView, @user.getSettings(), "clippingDistanceArbitrary",
      1, 127, 1, "Clipping Distance")
    @addCheckbox(@fView, @user.getSettings(), "displayCrosshair", "Show Crosshairs")
    (@fView.add @settingsGeneral, "quality", @qualityArray)
                          .name("Quality")
                          .onChange((v) => @setQuality(v))

    @folders.push(@fTDView = @gui.addFolder("3D View"))
    @addCheckbox(@fTDView, @user.getSettings(), "tdViewDisplayPlanes", "Display Planes")

    @folders.push(@fIsosurface = @gui.addFolder("Isosurface View"))
    @addCheckbox(
      @fIsosurface, @user.getSettings(), "isosurfaceDisplay", "Display Isosurface")
    @addSlider(@fIsosurface, @user.getSettings(), "isosurfaceBBsize",
      1, 10, 0.01, "Bounding Box size")
    @addSlider(@fIsosurface, @user.getSettings(), "isosurfaceResolution",
      40, 400, 1, "Resolution")

    if @settingsSkeleton?

      @folders.push( @fTrees = @gui.addFolder("Trees") )
      @activeTreeIdController = @addNumber(@fTrees, @settingsSkeleton, "activeTreeID",
        1, 1, "Active Tree ID", (value) => @trigger( "setActiveTree", value))
      if somaClickingAllowed
        @addCheckbox(@fTrees, @settingsSkeleton, "newNodeNewTree", "Soma clicking mode")
      else
        @set("newNodeNewTree", false, Boolean)

      @folders.push( @fNodes = @gui.addFolder("Nodes") )
      @activeNodeIdController = @addNumber(@fNodes, @settingsSkeleton, "activeNodeID",
        1, 1, "Active Node ID", (value) => @trigger( "setActiveNode", value))
      @radiusController = @addSlider(@fNodes, @settingsSkeleton, "radius",
        @model.skeletonTracing.MIN_RADIUS, @model.skeletonTracing.MAX_RADIUS, 1, "Radius", (radius) =>
          @model.skeletonTracing.setActiveNodeRadius( radius ))
      @particleSizeController = @addSlider(@fNodes, @user.getSettings(), "particleSize",
        constants.MIN_PARTICLE_SIZE, constants.MAX_PARTICLE_SIZE, 1, "Particle Size")
      @addCheckbox(@fNodes, @user.getSettings(), "overrideNodeRadius", "Override radius")
      @addFunction(@fNodes, @settingsSkeleton, "deleteActiveNode", "Delete Active Node")

    if @settingsVolume?

      @folders.push( @fCells = @gui.addFolder("Cells") )
      @activeCellIdController = @addNumber(@fCells, @settingsVolume, "activeCellID",
        0, 1, "Active Cell ID", (value) => @trigger( "setActiveCell", value))
      @addFunction(@fCells, @settingsVolume, "createNewCell", "Create new Cell")

    @fTrees?.open()
    @fNodes?.open()
    @fCells?.open()

    $("#dataset-name").text(@model.dataSetName)

    $("#trace-position-input").on "change", (event) =>

      @setPosFromString(event.target.value)
      $("#trace-position-input").blur()

    $("#trace-rotation-input").on "change", (event) =>

      @setRotationFromString(event.target.value)
      $("#trace-rotation-input").blur()

    $("#trace-finish-button").click (event) =>

      event.preventDefault()
      @saveNow().done =>
        if confirm("Are you sure you want to permanently finish this tracing?")
          window.location.href = event.target.href

    $("#trace-download-button").click (event) =>

      event.preventDefault()
      @saveNow().done =>
          window.location.href = event.target.href

    $("#trace-save-button").click (event) =>

      event.preventDefault()
      @saveNow()


    @model.flycam.on
      positionChanged : (position) =>
        @updateGlobalPosition(position)
      zoomStepChanged : =>
        @updateViewportWidth()

    @model.flycam3d.on
      changed : =>
        @updateViewportWidth()
        @updateRotation()

    @model.skeletonTracing?.on
      newActiveNode       : => @update()
      newActiveTree       : => @update()
      newActiveNodeRadius : => @update()
      deleteActiveTree    : => @update()
      deleteActiveNode    : => @update()
      deleteLastNode      : => @update()
      newNode             : => @update()
      newTree             : => @update()

    @model.volumeTracing?.on
      newActiveCell : => @update()

    @model.user.on
      scaleChanged : => @updateScale()
      zoomChanged : => @updateZoom()
      moveValueChanged : => @updateMoveValue()
      moveValue3dChanged : => @updateMoveValue3d()
      particleSizeChanged : => @updateParticleSize()

    @model.getSegmentationBinary()?.cube.on
      bucketLoaded : => @updateSegmentID()

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


  addColorPicker : (folder, object, propertyName, displayName, onChange) =>

    unless onChange?
      onChange = (v) => @set(propertyName, v, Number)
    return (folder.addColor object, propertyName)
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
    model = @model.skeletonTracing || @model.volumeTracing

    if @restrictions.allowUpdate and model?
      model.stateLogger.pushNow()
        .then(
          -> Toast.success("Saved!")
          -> Toast.error("Couldn't save. Please try again.")
        )
    else
      new $.Deferred().resolve()


  setBoundingBox : (value) =>

    bbArray = @stringToNumberArray( value )
    if bbArray?.length == 6
      @trigger("newBoundingBox", bbArray)


  setPosFromString : (posString) =>

    posArray = @stringToNumberArray( posString )
    if posArray?.length == 3
      @model.flycam.setPosition(posArray)
    else
      @updateGlobalPosition(@model.flycam.getPosition())


  setRotationFromString : (rotString) =>

    rotArray = @stringToNumberArray( rotString )
    if rotArray?.length == 3
      @model.flycam3d.setRotation rotArray
    else
      @updateRotation()


  stringToNumberArray : (s) ->

    # remove leading/trailing whitespaces
    s = s.trim()
    # replace remaining whitespaces with commata
    s = s.replace /,?\s+,?/g, ","
    stringArray = s.split(",")

    result = []
    for e in stringArray
      if not isNaN(newEl = parseFloat(e))
        result.push(newEl)
      else
        return null

    return result


  addTooltip : (element, title) ->

    $(element.domElement).parent().parent().tooltip({ title : title })


  createTooltips : ->

      $(".cr.number.has-slider").tooltip({"title" : "Move mouse up or down while clicking the number to easily adjust the value"})


  updateGlobalPosition : (globalPos) =>

    stringPos = Math.floor(globalPos[0]) + ", " + Math.floor(globalPos[1]) + ", " + Math.floor(globalPos[2])
    $("#trace-position-input").val(stringPos)
    @updateSegmentID()


  updateRotation : =>

    rotation = _.map(
      @model.flycam3d.getRotation(),
      (r) -> r.toFixed(2)
    )
    stringRot = rotation.join(", ")
    $("#trace-rotation-input").val(stringRot)

  updateSegmentID : ->

    if @model.getSegmentationBinary()?
      segmentID = @model.getSegmentationBinary().cube.getDataValue( @model.flycam.getPosition() )
      if segmentID?
        $("#segment-id").html("<p>Segment ID: " + segmentID + "</p>")
      else
        $("#segment-id").html("<p>Segment ID: -</p>")


  set : (name, value, type) =>

    @user.set( name, (type) value)


  setColorSettings : =>

    for binary in @model.getColorBinaries()
      binary.setColorSettings(@settingsGeneral.brightness, @settingsGeneral.contrast)
      binary.setColor @settingsGeneral[binary.name + "_color"]

    @brightnessContrastSettings.brightness = (Number) @settingsGeneral.brightness
    @brightnessContrastSettings.contrast = (Number) @settingsGeneral.contrast

    @user.push()
    @model.flycam.update()


  resetColorSettings : =>

    @model.setDefaultBinaryColors()
    @setupColors()

    for controller in @colorControllers
      controller.updateDisplay()

    @user.resetBrightnessContrastSettings(
      @model.datasetPostfix
    ).done (@brightnessContrastSettings) =>

      @settingsGeneral.brightness = @brightnessContrastSettings.brightness
      @settingsGeneral.contrast = @brightnessContrastSettings.contrast
      @setColorSettings()
      @brightnessController.updateDisplay()
      @contrastController.updateDisplay()


  setupColors : ->
    for binary, i in @model.getColorBinaries()
      @settingsGeneral[binary.name + "_color"] = binary.color

  setQuality : (value) =>

    for i in [0...@qualityArray.length]
      if @qualityArray[i] == value
        value = i
    @set("quality", value, Number)


  updateParticleSize : =>

    @particleSizeController?.updateDisplay()


  updateMoveValue : =>

    @moveValueController?.updateDisplay()


  updateMoveValue3d : =>

    @moveValue3dController?.updateDisplay()


  updateScale : =>

    @scaleController?.updateDisplay()


  updateZoom : =>

    @zoomController?.updateDisplay()


  update : ->

    # Helper method to combine common update methods
    # called when value user switch to different active node
    if @settingsSkeleton?
      @settingsSkeleton.activeNodeID = @model.skeletonTracing.getActiveNodeId() or -1
      @settingsSkeleton.activeTreeID = @model.skeletonTracing.getActiveTreeId()
      @settingsSkeleton.radius       = @model.skeletonTracing.getActiveNodeRadius()
      @activeNodeIdController.updateDisplay()
      @activeTreeIdController.updateDisplay()
      @radiusController.updateDisplay()
    if @settingsVolume?
      @settingsVolume.activeCellID = @model.volumeTracing.getActiveCellId()
      @activeCellIdController.updateDisplay()


  updateViewportWidth : ->

    if @mode in constants.MODES_PLANE
      zoom  = @model.flycam.getPlaneScalingFactor()
      width = constants.PLANE_WIDTH

    if @mode in constants.MODES_ARBITRARY
      zoom  = @model.flycam3d.zoomStep
      width = ArbitraryController::WIDTH

    nm = zoom * width * @model.scaleInfo.baseVoxel

    if(nm<1000)
      widthStr = nm.toFixed(0) + " nm</p>"
    else if (nm<1000000)
      widthStr = (nm / 1000).toFixed(1) + " μm</p>"
    else
      widthStr = (nm / 1000000).toFixed(1) + " mm</p>"

    $("#zoomFactor").html("<p>Viewport width: " + widthStr )


  setFolderVisibility : (folder, visible) ->

    $element = $(folder?.domElement)
    if visible then $element.show() else $element.hide()


  setFolderElementVisibility : (element, visible) ->

    $element = $(element.domElement).parents(".cr")
    if visible then $element.show() else $element.hide()


  hideFolders : (folders) ->

    for folder in folders
      @setFolderVisibility( folder, false)


  setMode : (@mode) ->

    for folder in @folders
      @setFolderVisibility(folder, true)
    @setFolderElementVisibility( @clippingControllerArbitrary, false )
    @setFolderElementVisibility( @clippingController, true )

    @setFolderVisibility(@fIsosurface, false)

    if      @mode == constants.MODE_PLANE_TRACING
      @hideFolders( [ @fFlightcontrols, @fCells ] )

    else if @mode == constants.MODE_ARBITRARY or mode == constants.MODE_ARBITRARY_PLANE
      @hideFolders( [ @fViewportcontrols, @fTDView, @fCells ] )
      @setFolderElementVisibility( @clippingControllerArbitrary, true )
      @setFolderElementVisibility( @clippingController, false )

    else if @mode == constants.MODE_VOLUME
      @hideFolders( [ @fTrees, @fNodes, @fFlightcontrols ] )
      @setFolderVisibility(@fIsosurface, true)

    @user.triggerAll()
    @updateViewportWidth()

