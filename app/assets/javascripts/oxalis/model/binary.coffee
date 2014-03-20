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


  constructor : (@model, tracing, @layer, tracingId) ->

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
    @pullQueue = new PullQueue(@model.dataSetName, @cube, @layer.name, tracingId, @boundingBox)
    @pushQueue = new PushQueue(@model.dataSetName, @cube, @layer.name, tracingId, tracing.version)
    @cube.setPushQueue( @pushQueue )

    @pingStrategies = [new PingStrategy.DslSlow(@cube, @TEXTURE_SIZE_P)]
    @pingStrategies3d = [new PingStrategy3d.DslSlow()]

    @planes = []
    for planeId in constants.ALL_PLANES
      @planes.push( new Plane2D(planeId, @cube, @pullQueue, @TEXTURE_SIZE_P, @layer.bitDepth, @targetBitDepth, 32) )

    if @layer.allowManipulation
      # assume zoom step count to be at least 1
      @contrastCurves = []
      contrastCurve = new Uint8Array(256)
      @contrastCurves[0] = new Uint8Array(256)

      for i in [1..@cube.ZOOM_STEP_COUNT]
        @contrastCurves[i] = contrastCurve

    @model.user.on({
      set4BitChanged : (is4Bit) => @pullQueue(is4Bit)
    })

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)


  setColor : (@color) ->

    @trigger "newColor", @color


  updateContrastCurve : (brightness, contrast) ->

    unless @contrastCurves?
      return

    contrastCurve = @contrastCurves[1]
    contrastCurveMag1 = @contrastCurves[0]

    for i in [0..255] by 1
      contrastCurve[i] = Math.max(Math.min((i + brightness) * contrast, 255), 0)
      contrastCurveMag1[i] = Math.max(Math.min((i + brightness + 8) * contrast, 255), 0)

    for plane in @planes
      plane.updateContrastCurves(@contrastCurves)


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

    contrastCurve = @contrastCurves[1]

    { buffer, accessedBuckets } = InterpolationCollector.bulkCollect(
      vertices
      @cube.getArbitraryCube()
    )

    @cube.accessBuckets(accessedBuckets)

    for i in [0...buffer.length] by 1
      buffer[i] = contrastCurve[buffer[i]]

    buffer
