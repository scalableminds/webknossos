### define 
./volumecell : VolumeCell
###

class VolumeTracing

  MODE_LASSO : 0
  MODE_DRAW  : 1

  constructor : () ->
    @cells        = []         # List of VolumeCells
    @currentCell  = null
    @currentLayer = null

  createCell : (id) ->
    @currentCell = new VolumeCell(id)
    @cells.push(@currentCell)

  startLayer : ->
    @currentNewLayer = @currentCell.createLayer()

  addToLayer : (x, y, z) ->
    unless @currentLayer
      @startNewLayer()
    @currentLayer.addContour(x, y, z)