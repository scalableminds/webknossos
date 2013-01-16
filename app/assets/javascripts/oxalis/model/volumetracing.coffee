### define 
./volumecell : VolumeCell
../../libs/event_mixin : EventMixin
###

MODE_LASSO = 0
MODE_DRAW  = 1

CLOSE_THRESHOLD = 3

class VolumeTracing

  constructor : () ->
    _.extend(@, new EventMixin())

    @cells        = []         # List of VolumeCells
    @currentCell  = null
    @currentLayer = null
    @mode         = MODE_LASSO

  createCell : (id) ->
    @currentCell = new VolumeCell(id)
    @cells.push(@currentCell)
    @startNewLayer()

  startNewLayer : ->
    # just for testing
    unless @currentCell?
      @createCell(1)
    @currentLayer = @currentCell.createLayer()
    @startPos = null
    @trigger "newLayer"

  addToLayer : (pos) ->
    unless @currentLayer?
      return
    unless @startPos?
      # Save where it started to notify when shape closed
      @startPos = pos.slice()
      @startPosLeft = false

    @currentLayer.addContour(pos)
    @trigger "newContour", pos

    distance = @distance(pos, @startPos)
    if (not @startPosLeft) and distance > CLOSE_THRESHOLD
      @startPosLeft = true
    else if @startPosLeft and distance < CLOSE_THRESHOLD
      # Done! Close shape.
      @currentLayer.addContour(@startPos)
      @trigger "newContour", @startPos
      @currentLayer = null

  distance : (pos1, pos2) ->
    sumOfSquares = 0
    for i in [0..2]
      diff = pos1[i] - pos2[i]
      sumOfSquares += diff * diff
    return Math.sqrt(sumOfSquares)