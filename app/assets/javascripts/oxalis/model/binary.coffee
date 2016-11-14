Backbone               = require("backbone")
InterpolationCollector = require("./binary/interpolation_collector")
Cube                   = require("./binary/cube")
PullQueue              = require("./binary/pullqueue")
PushQueue              = require("./binary/pushqueue")
Plane2D                = require("./binary/plane2d")
PingStrategy           = require("./binary/ping_strategy")
PingStrategy3d         = require("./binary/ping_strategy_3d")
BoundingBox            = require("./binary/bounding_box")
Mappings               = require("./binary/mappings")
Pipeline               = require("libs/pipeline")
constants              = require("../constants")

class Binary

  # Constants
  PING_THROTTLE_TIME : 50
  DIRECTION_VECTOR_SMOOTHER : .125
  TEXTURE_SIZE_P : 0

  cube : null
  pullQueue : null
  planes : []

  direction : [0, 0, 0]

  constructor : (@model, @tracing, @layer, maxZoomStep, @connectionInfo) ->

    _.extend(this, Backbone.Events)

    @TEXTURE_SIZE_P = constants.TEXTURE_SIZE_P
    { @category, @name } = @layer

    @targetBitDepth = if @category == "color" then @layer.bitDepth else 8

    {topLeft, width, height, depth} = @layer.maxCoordinates
    @lowerBoundary = @layer.lowerBoundary = topLeft
    @upperBoundary = @layer.upperBoundary = [ topLeft[0] + width, topLeft[1] + height, topLeft[2] + depth ]

    @cube = new Cube(@model.taskBoundingBox, @upperBoundary, maxZoomStep + 1, @layer.bitDepth)

    updatePipeline = new Pipeline([@tracing.version])

    datasetName = @model.get("dataset").get("name")
    datastoreInfo = @model.get("dataset").get("dataStore")
    @pullQueue = new PullQueue(@cube, @layer, @connectionInfo, datastoreInfo)
    @pushQueue = new PushQueue(datasetName, @cube, @layer, @tracing.id, updatePipeline)
    @cube.initializeWithQueues(@pullQueue, @pushQueue)
    @mappings = new Mappings(datasetName, @layer)
    @activeMapping = null

    @pingStrategies = [
      new PingStrategy.Skeleton(@cube, @TEXTURE_SIZE_P),
      new PingStrategy.Volume(@cube, @TEXTURE_SIZE_P)
    ]
    @pingStrategies3d = [
      new PingStrategy3d.DslSlow()
    ]

    @planes = []
    for planeId in constants.ALL_PLANES
      @planes.push( new Plane2D(planeId, @cube, @pullQueue, @TEXTURE_SIZE_P, @layer.bitDepth, @targetBitDepth,
                                32, @category == "segmentation") )

    if @layer.dataStoreInfo.typ == "webknossos-store"
      @layer.setFourBit(@model.get("datasetConfiguration").get("fourBit"))
      @listenTo(@model.get("datasetConfiguration"), "change:fourBit",
                (model, fourBit) -> @layer.setFourBit(fourBit) )

    @cube.on(
      newMapping : =>
        @forcePlaneRedraw()
    )

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)


  forcePlaneRedraw : ->

    for plane in @planes
      plane.forceRedraw()


  setActiveMapping : (mappingName) ->

    @activeMapping = mappingName

    setMapping = (mapping) =>
      @cube.setMapping(mapping)
      @model.flycam.update()

    if mappingName?
      @mappings.getMappingArrayAsync(mappingName).then(setMapping)
    else
      setMapping([])


  setActiveMapping : (mappingName) ->

    @activeMapping = mappingName

    setMapping = (mapping) =>
      @cube.setMapping(mapping)
      @model.flycam.update()

    if mappingName?
      @mappings.getMappingArrayAsync(mappingName).then(setMapping)
    else
      setMapping([])


  pingStop : ->

    @pullQueue.clearNormalPriorities()


  pingImpl : (position, {zoomStep, area, activePlane}) ->

    if @lastPosition?

      @direction = [
        (1 - @DIRECTION_VECTOR_SMOOTHER) * @direction[0] + @DIRECTION_VECTOR_SMOOTHER * (position[0] - @lastPosition[0])
        (1 - @DIRECTION_VECTOR_SMOOTHER) * @direction[1] + @DIRECTION_VECTOR_SMOOTHER * (position[1] - @lastPosition[1])
        (1 - @DIRECTION_VECTOR_SMOOTHER) * @direction[2] + @DIRECTION_VECTOR_SMOOTHER * (position[2] - @lastPosition[2])
      ]

    unless _.isEqual(position, @lastPosition) and zoomStep == @lastZoomStep and _.isEqual(area, @lastArea)

      @lastPosition = position.slice()
      @lastZoomStep = zoomStep
      @lastArea     = area.slice()

      for strategy in @pingStrategies
        if strategy.forContentType(@tracing.contentType) and strategy.inVelocityRange(@connectionInfo.bandwidth) and strategy.inRoundTripTimeRange(@connectionInfo.roundTripTime)
          if zoomStep? and area? and activePlane?
            @pullQueue.clearNormalPriorities()
            @pullQueue.addAll(strategy.ping(position, @direction, zoomStep, area, activePlane))
          break

      @pullQueue.pull()


  arbitraryPing : _.once (matrix, zoomStep) ->

    @arbitraryPing = _.throttle(@arbitraryPingImpl, @PING_THROTTLE_TIME)
    @arbitraryPing(matrix, zoomStep)


  arbitraryPingImpl : (matrix, zoomStep) ->

    for strategy in @pingStrategies3d
      if strategy.forContentType(@tracing.contentType) and strategy.inVelocityRange(1) and strategy.inRoundTripTimeRange(@pullQueue.roundTripTime)
        @pullQueue.clearNormalPriorities()
        @pullQueue.addAll(strategy.ping(matrix, zoomStep))
        break

    @pullQueue.pull()


  getByVerticesSync : (vertices) ->
    # A synchronized implementation of `get`. Cuz its faster.

    { buffer, missingBuckets } = InterpolationCollector.bulkCollect(
      vertices
      @cube.getArbitraryCube()
    )

    @pullQueue.addAll(missingBuckets.map(
      (bucket) ->
        bucket: bucket
        priority: PullQueue::PRIORITY_HIGHEST
    ))
    @pullQueue.pull()

    buffer

module.exports = Binary
