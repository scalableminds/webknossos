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

  constructor : (@flycam, @cube) ->
    _.extend(@, new EventMixin())

    @cells        = []          # List of VolumeCells
    @activeCell   = null        # Cell currently selected
    @activeLayer  = null        # Layer currently selected
    @currentLayer = null        # Layer currently edited
    @mode         = MODE_LASSO
    @idCount      = 1

  createCell : ->
    @activeCell = new VolumeCell(@idCount++)
    @setActiveLayer(null)
    @cells.push(@activeCell)
    @trigger "newCell", @activeCell

  startNewLayer : (planeId = @flycam.getActivePlane()) ->
    if currentLayer?
      return
    # just for testing
    unless @activeCell?
      @createCell()
    pos = Dimensions.roundCoordinate(@flycam.getPosition())
    thirdDimValue = pos[Dimensions.thirdDimensionForPlane(planeId)]
    @currentLayer = @activeCell.createLayer(planeId, thirdDimValue)
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

    @prevPos = pos.slice()

  finishLayer : ->
    unless @currentLayer?
      return

    @addToLayer(@startPos)
    startTime = new Date().getTime()
    voxelList = @currentLayer.getVoxelArray()
    #console.log "Time", (new Date().getTime() - startTime)#, @currentLayer.getVoxelArray()
    @cube.labelVoxels(voxelList, @activeCell.id % 6 + 1)

    @currentLayer = null
    @startPos = null
    @prevPos = null

  setActiveLayer : (layer) ->
    @activeLayer = layer
    if layer?
      @activeCell  = layer.cell
    @trigger "newActiveLayer"

  isActiveLayer : (layerId) ->
    return layerId == (if @activeLayer then @activeLayer.id else -1)

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
