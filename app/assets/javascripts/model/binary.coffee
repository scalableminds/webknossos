### define
model/binary/cube : Cube
model/binary/pullqueue : PullQueue
model/binary/plane2d : Plane2D
###

class Binary

  # Constants
  PING_THROTTLE_TIME : 50
  DIRECTION_VECTOR_SMOOTHER : .125

  cube : null
  queue : null
  planes : []

  dataSetId : ""
  direction : [0, 0, 0]
  

  constructor : (@dataSetId) ->

    @cube = new Cube()
    @queue = new PullQueue(@dataSetId, @cube)

    @planes = [
      new Plane2D(0, 1, 2, @cube, @queue)
      new Plane2D(2, 1, 0, @cube, @queue)
      new Plane2D(0, 2, 1, @cube, @queue)
    ]


  ping : (position, options) ->

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)
    @ping(position, options)


  pingImpl : (position, options) ->

    if @lastPosition?
      
      @direction = [
        (1 - @DIRECTION_VECTOR_SMOOTHER) * @direction[0] + @DIRECTION_VECTOR_SMOOTHER * (position[0] - @lastPosition[0])
        (1 - @DIRECTION_VECTOR_SMOOTHER) * @direction[1] + @DIRECTION_VECTOR_SMOOTHER * (position[1] - @lastPosition[1])
        (1 - @DIRECTION_VECTOR_SMOOTHER) * @direction[2] + @DIRECTION_VECTOR_SMOOTHER * (position[2] - @lastPosition[2])
      ]

    unless _.isEqual(position, @lastPosition) and _.isEqual(options, @lastOptions)

      @lastPosition = position.slice
      @lastOptions = options.slice

      console.time "ping"
      @queue.clear()

      for i in [0...Math.min(options.length, @planes.length)]
        @planes[i].ping(position, @direction, options[i]) if options[i]? 

      @queue.pull()
      console.timeEnd "ping"


  #get : (position, options) ->

   # for i in [0...Math.min(options.length, @planes.length)]
    #  @planes[i].get(position, options[i]) if options[i]?
