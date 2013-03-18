### define 
./volumecell : VolumeCell
./volumelayer : VolumeLayer
../../libs/event_mixin : EventMixin
./dimensions : Dimensions
###

# Point in polygon algorithm expects the path to be
# continous. Therefore, we need to ensure, that no
# edge is longer than specified.
MAX_EDGE_LENGTH = 2

MODE_NORMAL      = 0
MODE_SUB         = 1
MODE_ADD         = 2

class VolumeTracing

  constructor : (@flycam, @cube) ->
    _.extend(@, new EventMixin())

    @cells        = []          # List of VolumeCells
    @activeCell   = null        # Cell currently selected
    @activeLayer  = null        # Layer currently selected
    @currentLayer = null        # Layer currently edited
    @idCount      = 1

  createCell : ->
    @activeCell = new VolumeCell(@idCount++)
    @activeLayer = null
    @currentLayer = null
    @setActiveLayer(null)
    @cells.push(@activeCell)
    console.log("New Cell:", @activeCell.id)
    @trigger "newCell", @activeCell

  startEditing : (pos) ->
    if not @startNewLayer()
      
      planeId = @flycam.getActivePlane()
      thirdDimValue = pos[Dimensions.thirdDimensionForPlane(planeId)]
      layer = @activeCell.getLayer(planeId, thirdDimValue)

      if layer == @activeLayer
        if layer.containsVoxel(pos)
          layer.setMode(MODE_ADD)
        else
          layer.setMode(MODE_SUB)

        @currentLayer = layer

    console.log "Start editing"

  startNewLayer : (planeId = @flycam.getActivePlane()) ->
    # Return, if layer was actually started
    if currentLayer?
      return false
    # just for testing
    unless @activeCell?
      @createCell()
    pos = Dimensions.roundCoordinate(@flycam.getPosition())
    thirdDimValue = pos[Dimensions.thirdDimensionForPlane(planeId)]
    @currentLayer = @activeCell.createLayer(planeId, thirdDimValue)
    if @currentLayer?
      @trigger "newLayer", @activeCell.id
      return true
    return false

  addToLayer : (pos) ->

    pos = Dimensions.roundCoordinate(pos)
    unless @currentLayer?
      return
    unless @startPos?
      # Save where it started to close shape
      @startPos = pos.slice()

    for contour in @interpolationList(@prevPos, pos)
      @currentLayer.addContour(contour)
      @trigger "newContour", @activeCell.id, @currentLayer.id,
                            contour, (@currentLayer.mode != MODE_NORMAL)

    @prevPos = pos.slice()

  finishLayer : ->
    unless @currentLayer?
      return

    @addToLayer(@startPos)

    #Delete any voxel before VolumeLayer.finishLayer()
    iterator = @currentLayer.getVoxelIterator()
    @cube.labelVoxels(iterator, 0)
    @currentLayer.finishLayer()
    iterator = @currentLayer.getVoxelIterator()
    @cube.labelVoxels(iterator, @activeCell.id % 6 + 1)

    @currentLayer = null
    @startPos = null
    @prevPos = null

    @trigger "layerUpdate"
    
    console.log "Finish Layer"

  selectLayer : (pos) ->

    for cell in @cells
      activePlane = @flycam.getActivePlane()
      thirdDimValue = pos[Dimensions.thirdDimensionForPlane(activePlane)]
      layer = cell.getLayer(activePlane, thirdDimValue)

      if layer?.containsVoxel(pos)
        @setActiveLayer(layer)

  setActiveLayer : (layer) ->
    console.log("Set active layer!")
    @activeLayer = layer
    if layer?
      @activeCell  = layer.cell
    @trigger "layerUpdate"

  isActiveLayer : (cellId, layerId) ->
    return cellId == @activeCell?.id and
      layerId == (if @activeLayer then @activeLayer.id else -1)

  interpolationList : (posSource, posTarget) ->
    # ensure that no edge is longer than MAX_EDGE_LENGTH
    unless posSource?
      return [posTarget]
    distance = Dimensions.distance(posSource, posTarget)
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
