Backbone                 = require("backbone")
VolumeCell               = require("./volumecell")
VolumeLayer              = require("./volumelayer")
Dimensions               = require("../dimensions")
RestrictionHandler       = require("../helpers/restriction_handler")
Drawing                  = require("libs/drawing")
VolumeTracingStateLogger = require("./volumetracing_statelogger")
Constants                = require("../../constants")

class VolumeTracing

  constructor : (tracing, @flycam, @flycam3d, @binary) ->

    _.extend(this, Backbone.Events)

    @contentData  = tracing.content.contentData
    @restrictionHandler = new RestrictionHandler(tracing.restrictions)
    @mode = Constants.VOLUME_MODE_MOVE

    @cells        = []
    @activeCell   = null
    @currentLayer = null        # Layer currently edited
    @idCount      = @contentData.nextCell || 1
    @lastCentroid = null

    @stateLogger  = new VolumeTracingStateLogger(
      @flycam, tracing.version, tracing.id, tracing.typ,
      tracing.restrictions.allowUpdate,
      this, @binary.pushQueue
    )

    @createCell(@contentData.activeCell)

    @listenTo(@binary.cube, "newMapping", ->
      @trigger("newActiveCell", @getActiveCellId())
    )

    # For testing
    window.setAlpha = (v) -> Drawing.setAlpha(v)
    window.setSmoothLength = (v) -> Drawing.setSmoothLength(v)


  setMode : (@mode) ->

    @trigger("change:mode", @mode)


  toggleMode : ->

    @setMode(
      if @mode == Constants.VOLUME_MODE_TRACE
        Constants.VOLUME_MODE_MOVE
      else
        Constants.VOLUME_MODE_TRACE
    )


  createCell : (id) ->

    unless id?
      id = @idCount++

    @cells.push( newCell = new VolumeCell(id) )
    @setActiveCell( newCell.id )
    @currentLayer = null


  startEditing : (planeId) ->
    # Return, if layer was actually started

    return false if not @restrictionHandler.updateAllowed()

    if currentLayer? or @flycam.getIntegerZoomStep() > 0
      return false

    pos = Dimensions.roundCoordinate(@flycam.getPosition())
    thirdDimValue = pos[Dimensions.thirdDimensionForPlane(planeId)]
    @currentLayer = new VolumeLayer(planeId, thirdDimValue)
    return true


  addToLayer : (pos) ->

    return if not @restrictionHandler.updateAllowed()

    unless @currentLayer?
      return

    @currentLayer.addContour(pos)
    @trigger "updateLayer", @getActiveCellId(), @currentLayer.getSmoothedContourList()


  finishLayer : ->

    return if not @restrictionHandler.updateAllowed()

    if not @currentLayer? or @currentLayer.isEmpty()
      return

    start = (new Date()).getTime()
    @currentLayer.finish()
    iterator = @currentLayer.getVoxelIterator()
    labelValue = if @activeCell then @activeCell.id else 0
    @binary.cube.labelVoxels(iterator, labelValue)
    console.log "Labeling time:", ((new Date()).getTime() - start)

    @updateDirection(@currentLayer.getCentroid())
    @currentLayer = null

    @trigger "volumeAnnotated"


  updateDirection : (centroid) ->
    if @lastCentroid?
      @flycam.setDirection([
        centroid[0] - @lastCentroid[0]
        centroid[1] - @lastCentroid[1]
        centroid[2] - @lastCentroid[2]
      ])
    @lastCentroid = centroid


  getActiveCellId : ->

    if @activeCell?
      return @activeCell.id
    else
      return 0


  getMappedActiveCellId : ->

    return @binary.cube.mapId(@getActiveCellId())


  setActiveCell : (id) ->

    @activeCell = null
    for cell in @cells
      if cell.id == id then @activeCell = cell

    if not @activeCell? and id > 0
      @createCell(id)

    @trigger "newActiveCell", id

module.exports = VolumeTracing
