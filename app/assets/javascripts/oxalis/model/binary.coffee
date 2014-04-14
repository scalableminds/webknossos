### define
./binary/interpolation_collector : InterpolationCollector
./binary/cube : Cube
./binary/pullqueue : PullQueue
./binary/pushqueue : PushQueue
./binary/plane2d : Plane2D
./binary/ping_strategy : PingStrategy
./binary/ping_strategy_3d : PingStrategy3d
./binary/bounding_box : BoundingBox
../constants : constants
libs/event_mixin : EventMixin
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


  constructor : (@model, tracing, @layer, tracingId, updatePipeline) ->

    _.extend(this, new EventMixin())

    @TEXTURE_SIZE_P = constants.TEXTURE_SIZE_P
    { @category, @name } = @layer

    @lastPingTime   = new Date()
    @queueStatus    = 0
    @targetBitDepth = if @category == "color" then @layer.bitDepth else 8

    {topLeft, width, height, depth} = @layer.maxCoordinates
    @lowerBoundary  = topLeft
    @upperBoundary  = [ topLeft[0] + width, topLeft[1] + height, topLeft[2] + depth ]

    @cube = new Cube(@upperBoundary, @layer.resolutions.length, @layer.bitDepth)
    @boundingBox = new BoundingBox(@model.boundingBox, @cube)
    @pullQueue = new PullQueue(@model.dataSetName, @cube, @layer, tracingId, @boundingBox)
    @pushQueue = new PushQueue(@model.dataSetName, @cube, @layer, tracingId, updatePipeline)
    @cube.setPushQueue( @pushQueue )

    @pingStrategies = [new PingStrategy.DslSlow(@cube, @TEXTURE_SIZE_P)]
    @pingStrategies3d = [new PingStrategy3d.DslSlow()]

    @planes = []
    for planeId in constants.ALL_PLANES
      @planes.push( new Plane2D(planeId, @cube, @pullQueue, @TEXTURE_SIZE_P, @layer.bitDepth, @targetBitDepth, 32) )

    @model.user.on({
      set4BitChanged : (is4Bit) => @pullQueue(is4Bit)
    })

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)


  setColor : (@color) ->

    @trigger "newColor", @color


  setColorSettings : (brightness, contrast) ->

    @trigger "newColorSettings", brightness, contrast


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
        if strategy.inVelocityRange(1) and strategy.inRoundTripTimeRange(@pullQueue.roundTripTime)

          pullQueue = strategy.ping(position, @direction, zoomStep, area, activePlane) if zoomStep? and area? and activePlane?
          @pullQueue.clear()
          for entry in pullQueue
            @pullQueue.insert(entry...)

          break

      @queueStatus
      @pullQueue.pull()


  arbitraryPing : _.once (matrix) ->

    @arbitraryPing = _.throttle(@arbitraryPingImpl, @PING_THROTTLE_TIME)
    @arbitraryPing(matrix)


  arbitraryPingImpl : (matrix) ->

    for strategy in @pingStrategies3d
      if strategy.inVelocityRange(1) and strategy.inRoundTripTimeRange(@pullQueue.roundTripTime)

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
