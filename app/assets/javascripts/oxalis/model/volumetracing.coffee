### define 
./volumecell : VolumeCell
../../libs/event_mixin : EventMixin
./dimensions : DimensionsHelper
###

MODE_LASSO = 0
MODE_DRAW  = 1

CLOSE_THRESHOLD = 3

class VolumeTracing

  constructor : (@flycam) ->
    _.extend(@, new EventMixin())

    @cells        = []         # List of VolumeCells
    @currentCell  = null
    @currentLayer = null
    @mode         = MODE_LASSO

  createCell : (id) ->
    @currentCell = new VolumeCell(id)
    @cells.push(@currentCell)
    @trigger "newCell", @currentCell

  startNewLayer : (planeId = @flycam.getActivePlane()) ->
    if currentLayer?
      return
    # just for testing
    unless @currentCell?
      @createCell(1)
    pos = @flycam.getGlobalPos()
    thirdDimValue = pos[Dimensions.thirdDimensionForPlane(planeId)]
    @currentLayer = @currentCell.createLayer(planeId, thirdDimValue)
    if @currentLayer?
      @trigger "newLayer"

  addToLayer : (pos) ->
    unless @currentLayer?
      return
    unless @startPos?
      # Save where it started to close shape
      @startPos = pos.slice()

    @currentLayer.addContour(pos)
    @trigger "newContour", @currentLayer.id, pos

  finishLayer : ->
    unless @currentLayer?
      return

    @currentLayer.addContour(@startPos)
    @trigger "newContour", @currentLayer.id, @startPos
    @currentLayer = null
    @startPos = null

  distance : (pos1, pos2) ->
    sumOfSquares = 0
    for i in [0..2]
      diff = pos1[i] - pos2[i]
      sumOfSquares += diff * diff
    return Math.sqrt(sumOfSquares)