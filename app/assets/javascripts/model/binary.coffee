### define
model/binary/cube : Cube
model/binary/pullqueue : PullQueue
model/binary/plane2d : Plane2D
###

class Binary

  # Constants
  PING_THROTTLE_TIME : 1000
  TEXTURE_SIZE : 512

  cube : null
  queue : null
  planes : []

  dataSetId : ""
  

  constructor : (dataSetId) ->

    @dataSetId = dataSetId

    @cube = new Cube()
    @queue = new PullQueue(@dataSetId, @cube)

    @planes = [
      new Plane2D(0, 1, 2, @cube, @queue)
      new Plane2D(1, 0, 2, @cube, @queue)
      new Plane2D(2, 0, 1, @cube, @queue)
    ]

    @cube.on "bucketLoaded", (bucket, newZoomStep, oldZoomStep) =>

      for plane in @planes
        plane.bucketLoaded(bucket, newZoomStep, oldZoomStep)


  ping : (position, options) ->

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)
    @ping(position, options)


  pingImpl : (position, options) ->

    unless _.isEqual(position, @lastPosition) and _.isEqual(options, @lastOptions)

      @lastPosition = position
      @lastOptions = options

      console.time "ping"
      @queue.clear()

      for i in [0...Math.min(options.length, @planes.length)]
        @planes[i].ping(position, options[i]) if options[i]?

      @queue.pull()
      console.timeEnd "ping"


  get : (position, options) ->

    for i in [0...Math.min(options.length, @planes.length)]
      @planes[i].get(position, options[i]) if options[i]?
