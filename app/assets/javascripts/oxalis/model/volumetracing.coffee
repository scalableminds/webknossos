### define 
./volumecell : VolumeCell
./volumelayer : VolumeLayer
../../libs/event_mixin : EventMixin
./dimensions : Dimensions
libs/drawing : Drawing
###

class VolumeTracing

  constructor : (@flycam, @cube) ->

    _.extend(@, new EventMixin())

    @cells        = []          # List of VolumeCells
    @activeCell   = null        # Cell currently selected
    @currentLayer = null        # Layer currently edited
    @idCount      = 1

    @createCell()

    # For testing
    window.setAlpha = (v) -> Drawing.setAlpha(v)
    window.setSmoothLength = (v) -> Drawing.setSmoothLength(v)


  createCell : ->

    @cells.push( newCell = new VolumeCell(@idCount++) )
    @setActiveCell( newCell.id )
    @currentLayer = null


  startEditing : (planeId) ->

    # Return, if layer was actually started
    if currentLayer?
      return false
    pos = Dimensions.roundCoordinate(@flycam.getPosition())
    thirdDimValue = pos[Dimensions.thirdDimensionForPlane(planeId)]
    @currentLayer = new VolumeLayer(planeId, thirdDimValue)
    return true


  addToLayer : (pos) ->

    unless @currentLayer?
      return

    @currentLayer.addContour(pos)
    @trigger "updateLayer", @currentLayer.getSmoothedContourList()

  finishLayer : ->

    unless @currentLayer?
      return

    start = (new Date()).getTime()
    iterator = @currentLayer.getVoxelIterator()
    labelValue = if @activeCell then ( @activeCell.id % 6 + 1 ) else 0
    @cube.labelVoxels(iterator, labelValue)
    console.log "Labeling time:", ((new Date()).getTime() - start)

    @currentLayer = null
    @flycam.update()

    @trigger "resetContour"


  getActiveCellId : ->

    if @activeCell?
      return @activeCell.id
    else
      return 0
      

  setActiveCell : (id) ->

    @activeCell = null
    for cell in @cells
      if cell.id == id then @activeCell = cell

    console.log @getActiveCellId()
    @trigger "newActiveCell"
