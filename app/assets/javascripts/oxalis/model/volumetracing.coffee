### define 
./volumecell : VolumeCell
../../libs/event_mixin : EventMixin
###

MODE_LASSO = 0
MODE_DRAW  = 1

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
    @trigger "newLayer"

  addToLayer : (pos) ->
    unless @currentLayer?
      @startNewLayer()
    @currentLayer.addContour(pos)
    @trigger "newContour", pos