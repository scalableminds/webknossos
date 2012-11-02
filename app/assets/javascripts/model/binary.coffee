### define
model/binary/cube : Cube
model/binary/pullqueue : PullQueue
model/binary/plane2d : Plane2D
###


class Binary


  # Constants
  PING_THROTTLE_TIME : 1000
  TEXTURE_SIZE : 512

  dataSetId : ""

  cube : null
  queue : null
  planes : null


  constructor : (dataSetId) ->

    @dataSetId = dataSetId

    @cube = new Cube()
    @queue = new PullQueue(@dataSetId, @cube)

    @planes = [
      new Plane2D(0, 1, 2, @cube)
      new Plane2D(1, 0, 2, @cube)
      new Plane2D(2, 0, 1, @cube)
    ]

#    @cube = new Cube()
 #   @queue =  # TODO

#    @cube.on "bucketLoaded", (bucket, newZoomStep, oldZoomStep) =>

 #     for i in [0..2] by 1
#        plane = @planes[i]

  #      continue unless plane.topLeftBucket

   #     if plane.layer >> 5 == bucket[plane.view.w] and oldZoomStep > plane.zoomStep
#
 #         u = (bucket[plane.view.u] >> plane.zoomStep) - plane.topLeftBucket[plane.view.u]
  #        v = (bucket[plane.view.v] >> plane.zoomStep) - plane.topLeftBucket[plane.view.v]

   #       if u in [0..@TEXTURE_SIZE >> 5] and v in [0..@TEXTURE_SIZE >> 5]
    #          #TODO Macro-Fix
     #         tile = [u, v]
      #        plane.tiles[tileIndexByTileMacro(tile)] = true
       #       if u in [plane.area[0]..plane.area[2]] and v in [plane.area[1]..plane.area[3]]
        #        plane.changed = true

  ping : (position, zoomSteps, direction) ->

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)
    @ping(position, zoomSteps, direction)

  pingImpl : (position, zoomSteps) ->

    unless _.isEqual(position, @lastPosition) and _.isEqual(zoomSteps, @lastZoomSteps)

      lastPosition = @lastPosition

      unless lastPosition
        lastPosition = [0, 0, 0]

      unless @lastDirection
        @lastDirection = [1, 0, 0]

      @lastPosition = position
      @lastZoomSteps = zoomSteps.slice(0)

      console.time "ping"

      positionBucket = [position[0] >> 5, position[1] >> 5, position[2] >> 5]
      zoomedPositionBucket = [positionBucket[0] >> zoomSteps[0], positionBucket[1] >> zoomSteps[0], positionBucket[2] >> zoomSteps[0]]

      resizeRadius = 6
      
      buckets  = @getBucketArray(zoomedPositionBucket, resizeRadius-2, resizeRadius-2, 0).concat(
                  @getBucketArray(zoomedPositionBucket, resizeRadius-2, 0, resizeRadius-2),
                  @getBucketArray(zoomedPositionBucket, 0, resizeRadius-2, resizeRadius-2))

      @cube.extendByBucketAddressExtent(
        [(zoomedPositionBucket[0] - resizeRadius) << zoomSteps[0], (zoomedPositionBucket[1] - resizeRadius) << zoomSteps[0], (zoomedPositionBucket[2] - resizeRadius) << zoomSteps[0]],
        [(zoomedPositionBucket[0] + resizeRadius) << zoomSteps[0], (zoomedPositionBucket[1] + resizeRadius) << zoomSteps[0], (zoomedPositionBucket[2] + resizeRadius) << zoomSteps[0]]
     #   0,0,0,200,200,200
      )

      console.time "queue"
      @queue.clear()

      newDirection = [
        position[0] - lastPosition[0],
        position[1] - lastPosition[1],
        position[2] - lastPosition[2]
      ]

      @lastDirection = [
        @lastDirection[0] * 0.8 + newDirection[0] * 0.2,
        @lastDirection[1] * 0.8 + newDirection[1] * 0.2,
        @lastDirection[2] * 0.8 + newDirection[2] * 0.2
      ]

      directionMax = Math.abs(Math.max(@lastDirection[0], @lastDirection[1], @lastDirection[2]))

      loadDirection = @lastDirection
      unless directionMax == 0
        loadDirection[0] /= directionMax;
        loadDirection[1] /= directionMax;
        loadDirection[2] /= directionMax;

      delta_x = delta_y = delta_z = 0
      direction_x = direction_y = direction_z = 0
      index = buckets.length
      level = 0

      i = buckets.length * @PRELOADING.length
      while i--
        index--
        if buckets[index]
          @queue.insert [buckets[index][0] + direction_x, buckets[index][1] + direction_y, buckets[index][2] + direction_z, zoomSteps[0]], @PRIORITIES[index % @PRIORITIES.length]# + @PRELOADING[level]# + buckets3.length

        unless i % buckets.length
          index = buckets.length
          level++

          delta_x += loadDirection[0]
          delta_y += loadDirection[1]
          delta_z += loadDirection[2]
          direction_x = Math.round(delta_x)
          direction_y = Math.round(delta_y)
          direction_z = Math.round(delta_z)

    @queue.pull()


  get : (position, zoomStep, area, plane) ->

    $.when(@getSync(position, zoomStep, area, plane))


  getSync : (position, zoomStep, area, plane) ->

    # TODO
    if plane == 0
      @planes[plane].get(position, zoomStep, area)


  getBucketArray : (center, range_x, range_y, range_z) ->

    buckets = []

    #TODO
    for z in [-range_z..range_z]
      for y in [-range_y..range_y]
        for x in [-range_x..range_x]
          bucket = [center[0] + x, center[1] + y, center[2] + z]
          if x < 8 and y < 8 and z < 8
            buckets.push if _.min(bucket) >= 0 then bucket else null

    buckets
