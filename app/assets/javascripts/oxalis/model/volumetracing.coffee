### define 
./volumecell : VolumeCell
../../libs/event_mixin : EventMixin
./dimensions : Dimensions
###

MODE_LASSO = 0
MODE_DRAW  = 1

# Point in polygon algorithm expects the path to be
# continous. Therefore, we need to ensure, that no
# edge is longer than specified.
MAX_EDGE_LENGTH = 2

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
    pos = Dimensions.roundCoordinate(@flycam.getPosition())
    thirdDimValue = pos[Dimensions.thirdDimensionForPlane(planeId)]
    @currentLayer = @currentCell.createLayer(planeId, thirdDimValue)
    if @currentLayer?
      @trigger "newLayer"

  addToLayer : (pos) ->

    pos = Dimensions.roundCoordinate(pos)
    unless @currentLayer?
      return
    unless @startPos?
      # Save where it started to close shape
      @startPos = pos.slice()

    for contour in @interpolationList(@prevPos, pos)
      @currentLayer.addContour(contour)
      @trigger "newContour", @currentLayer.id, contour
      #console.log "contour", contour

    @prevPos = pos.slice()

  finishLayer : ->
    unless @currentLayer?
      return

    @addToLayer(@startPos)
    @currentLayer = null
    @startPos = null
    @prevPos = null

  distance : (pos1, pos2) ->
    sumOfSquares = 0
    for i in [0..2]
      diff = pos1[i] - pos2[i]
      sumOfSquares += diff * diff
    return Math.sqrt(sumOfSquares)

  interpolationList : (posSource, posTarget) ->
    # ensure that no edge is longer than MAX_EDGE_LENGTH
    unless posSource?
      return [posTarget]
    distance = @distance(posSource, posTarget)
    if distance <= MAX_EDGE_LENGTH
      return [posTarget]

    pieces = distance / MAX_EDGE_LENGTH
    diff = [(posTarget[0] - posSource[0]) / pieces,
            (posTarget[1] - posSource[1]) / pieces,
            (posTarget[2] - posSource[2]) / pieces]

    res = []
    for i in [0..Math.floor(pieces)]
      res.push(Dimensions.roundCoordinate([
                  posSource[0] + i * diff[0],
                  posSource[1] + i * diff[1],
                  posSource[2] + i * diff[2]
                  ]))
    return res.concat([posTarget])
