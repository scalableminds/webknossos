### define
./binary/cube : Cube
./binary/pullqueue : PullQueue
./binary/plane2d : Plane2D
./binary/ping_strategy : PingStrategy
./dimensions : DimensionHelper
###

class Binary

  # Constants
  PING_THROTTLE_TIME : 50
  DIRECTION_VECTOR_SMOOTHER : .125
  TEXTURE_SIZE_P : 0

  cube : null
  queue : null
  planes : []

  dataSetId : ""
  direction : [0, 0, 0]
  

  constructor : (flycam, dataSet, @TEXTURE_SIZE_P) ->

    @dataSetId = dataSet.id

    @cube = new Cube(dataSet.upperBoundary)
    @queue = new PullQueue(@dataSetId, @cube)

    @planes = []
    @planes[Dimensions.PLANE_XY] = new Plane2D(Dimensions.PLANE_XY, @cube, @queue, @TEXTURE_SIZE_P)
    @planes[Dimensions.PLANE_XZ] = new Plane2D(Dimensions.PLANE_XZ, @cube, @queue, @TEXTURE_SIZE_P)
    @planes[Dimensions.PLANE_YZ] = new Plane2D(Dimensions.PLANE_YZ, @cube, @queue, @TEXTURE_SIZE_P)


  ping : _.once (position, options) ->

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)
    @ping(position, options)


  updateLookupTable : (brightness, contrast) ->

    console.log brightness, contrast


  pingImpl : (position, options) ->

    if @lastPosition?
      
      @direction = [
        (1 - @DIRECTION_VECTOR_SMOOTHER) * @direction[0] + @DIRECTION_VECTOR_SMOOTHER * (position[0] - @lastPosition[0])
        (1 - @DIRECTION_VECTOR_SMOOTHER) * @direction[1] + @DIRECTION_VECTOR_SMOOTHER * (position[1] - @lastPosition[1])
        (1 - @DIRECTION_VECTOR_SMOOTHER) * @direction[2] + @DIRECTION_VECTOR_SMOOTHER * (position[2] - @lastPosition[2])
      ]

    unless _.isEqual(position, @lastPosition) and _.isEqual(options, @lastOptions)

      console.log position, @queue.roundTripTime, @queue.bucketsPerSecond

      @lastPosition = position.slice()
      @lastOptions = options.slice()

      console.time "ping"
      @queue.clear()


      for plane in @planes
        plane.ping(position, @direction, options[plane.index]) if options[plane.index]? 

      @queue.pull()
      console.timeEnd "ping"


  # Not used anymore. Instead the planes get-functions are called directly.
  #get : (position, options) ->

   # for i in [0...Math.min(options.length, @planes.length)]
    #  @planes[i].get(position, options[i]) if options[i]?

