### define
backbone : Backbone
./binary/interpolation_collector : InterpolationCollector
./binary/cube : Cube
./binary/pullqueue : PullQueue
./binary/pushqueue : PushQueue
./binary/plane2d : Plane2D
./binary/ping_strategy : PingStrategy
./binary/ping_strategy_3d : PingStrategy3d
./binary/bounding_box : BoundingBox
../constants : constants
###

class Binary

  # Constants
  PING_THROTTLE_TIME : 50
  DIRECTION_VECTOR_SMOOTHER : .125
  TEXTURE_SIZE_P : 0

  cube : null
  pullQueue : null
  planes : []

  direction : [0, 0, 0]

  constructor : (@model, @tracing, @layer, maxZoomStep, updatePipeline, @connectionInfo) ->

    _.extend(this, Backbone.Events)

    @TEXTURE_SIZE_P = constants.TEXTURE_SIZE_P
    { @category, @name } = @layer

    @targetBitDepth = if @category == "color" then @layer.bitDepth else 8

    {topLeft, width, height, depth} = @layer.maxCoordinates
    @lowerBoundary  = topLeft
    @upperBoundary  = [ topLeft[0] + width, topLeft[1] + height, topLeft[2] + depth ]

    @cube = new Cube(@upperBoundary, maxZoomStep + 1, @layer.bitDepth)
    @boundingBox = new BoundingBox(@model.boundingBox, @cube)

    datasetName = @model.get("dataset").get("name")
    @pullQueue = new PullQueue(datasetName, @cube, @layer, tracingId, @boundingBox, connectionInfo)
    @pushQueue = new PushQueue(datasetName, @cube, @layer, tracingId, updatePipeline)
    @cube.setPushQueue( @pushQueue )

    @pingStrategies = [
      new PingStrategy.Skeleton(@cube, @TEXTURE_SIZE_P),
      new PingStrategy.Volume(@cube, @TEXTURE_SIZE_P)
    ]
    @pingStrategies3d = [
      new PingStrategy3d.DslSlow()
    ]

    @planes = []
    for planeId in constants.ALL_PLANES
      @planes.push( new Plane2D(planeId, @cube, @pullQueue, @TEXTURE_SIZE_P, @layer.bitDepth, @targetBitDepth, 32) )

    @pullQueue.set4Bit(@model.get("dataset").get("fourBit"))
    @listenTo(@model.get("dataset"), "change:fourBit" , (model, is4Bit) -> @pullQueue.set4Bit(is4Bit) )

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)


  pingStop : ->

    @pullQueue.clear()


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
          @pullQueue.queue = strategy.ping(position, @direction, zoomStep, area, activePlane) if zoomStep? and area? and activePlane?
          break

      @queueStatus
      @pullQueue.pull()


  arbitraryPing : _.once (matrix) ->

    @arbitraryPing = _.throttle(@arbitraryPingImpl, @PING_THROTTLE_TIME)
    @arbitraryPing(matrix)


  arbitraryPingImpl : (matrix) ->

    for strategy in @pingStrategies3d
      if strategy.forContentType(@tracing.contentType) and strategy.inVelocityRange(1) and strategy.inRoundTripTimeRange(@pullQueue.roundTripTime)

        pullQueue = strategy.ping(matrix)

        for entry in pullQueue
          @pullQueue.insert(entry...)

        break

    @pullQueue.pull()


  getByVerticesSync : (vertices) ->
    # A synchronized implementation of `get`. Cuz its faster.

    { buffer, accessedBuckets } = InterpolationCollector.bulkCollect(
      vertices
      @cube.getArbitraryCube()
    )

    @cube.accessBuckets(accessedBuckets)

    buffer
