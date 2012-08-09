  pingImpl : (position, zoomStep, direction) ->

    unless _.isEqual({ position, zoomStep, direction }, { @lastPosition, @lastZoomStep, @lastDirection })

      @lastPosition = position
      @lastZoomStep = zoomStep
      @lastDirection = direction

      console.time "ping"

      positionBucket = [position[0] >> (5 + zoomStep), position[1] >> (5 + zoomStep), position[2] >> (5 + zoomStep)]
      buckets   = @getBucketArray(@positionBucket, @TEXTURE_SIZE >> (6 + zoomStep), @TEXTURE_SIZE >> 6, 0).concat(
                  @getBucketArray(@positionBucket, @TEXTURE_SIZE >> 6, 0, @TEXTURE_SIZE >> 6),
                  @getBucketArray(@positionBucket, 0, @TEXTURE_SIZE >> 6, @TEXTURE_SIZE >> 6))
      # Buckets of zoom step 3 so that there won't be any black
      positionBucket3 = [position[0] >> (5 + 3), position[1] >> (5 + 3), position[2] >> (5 + 3)]
      buckets3  = @getBucketArray(@positionBucket, @TEXTURE_SIZE >> (6 + zoomStep), @TEXTURE_SIZE >> (6 + zoomStep), 0).concat(
                  @getBucketArray(@positionBucket, @TEXTURE_SIZE >> (6 + zoomStep), 0, @TEXTURE_SIZE >> (6 + zoomStep)),
                  @getBucketArray(@positionBucket, 0, @TEXTURE_SIZE >> (6 + zoomStep), @TEXTURE_SIZE >> (6 + zoomStep)))
      
      Cube.extendByBucketAddressExtent6(
        @positionBucket[0] - (@TEXTURE_SIZE >> 6), @positionBucket[1] - (@TEXTURE_SIZE >> 6), @positionBucket[2] - (@TEXTURE_SIZE >> 6),
        @positionBucket[0] + (@TEXTURE_SIZE >> 6), @positionBucket[1] + (@TEXTURE_SIZE >> 6), @positionBucket[2] + (@TEXTURE_SIZE >> 6),
        zoomStep)

      #Cube.extendByBucketAddressExtent6(0, 0, 0, 7, 7, 7)

      #console.time "queue"
      PullQueue.clear()

      direction = [0,0,1]
      directionValue = Math.sqrt(direction[0]*direction[0] + direction[1]*direction[1] + direction[2]*direction[2])
      directionMax   = Math.max(direction[0], direction[1], direction[2])
      direction      = [direction[0]/directionMax, direction[1]/directionMax, direction[2]/directionMax]

      directionValue = Math.max(directionValue, 0.01)         # so there is no division by 0
      preloading = [0, Math.round(10/directionValue),         # TODO: optimze those values
                    Math.round(100/directionValue),
                    Math.round(200/directionValue),
                    Math.round(300/directionValue)]

      delta_x = delta_y = delta_z = 0
      direction_x = direction_y = direction_z = 0
      index = buckets.length
      level = 0

      if zoomStep != 3            # don't do this if you need to load the lowest resolution anyway
        for coordinate in [0..2]
          i = [0, 0, 0]
          for indexValue in [0, 1, -1]
            i[coordinate] = indexValue
            for b in buckets3
              priority = Math.max(Math.abs(b[0] - positionBucket3[0]), Math.abs(b[1] - positionBucket3[1]), Math.abs(b[2] - positionBucket3[2]))
              PullQueue.insert [b[0] + i[0], b[1] + i[1], b[2] + i[2]], 3, priority +Math.abs(indexValue)*buckets3.length

      i = buckets.length * preloading.length
      while i--
        index--
        if buckets[index]
          priority = Math.max(Math.abs(buckets[index][0] - positionBucket[0]), Math.abs(buckets[index][1] - positionBucket[1]), Math.abs(buckets[index][2] - positionBucket3[2]))
          PullQueue.insert [buckets[index][0] + direction_x, buckets[index][1] + direction_y, buckets[index][2] + direction_z], zoomStep, @PRIORITIES[index % @PRIORITIES.length] + preloading[level] + buckets3.length

        unless i % buckets.length
          index = buckets.length
          level++

          delta_x += direction[0]
          delta_y += direction[1]
          delta_z += direction[2]
          direction_x = Math.round(delta_x)
          direction_y = Math.round(delta_y)
          direction_z = Math.round(delta_z)

      #PullQueue.insert [0, 0, 0], 3, 0
      #PullQueue.insert [0, 0, 0], 1, 1
      #PullQueue.insert [1, 1, 0], 1, 2
      #PullQueue.insert [0, 0, 0], 0, 3
      #PullQueue.insert [0, 1, 0], 0, 4
      #PullQueue.insert [0, 2, 0], 0, 5
      #PullQueue.insert [0, 3, 0], 0, 6

      console.timeEnd "queue"
      
      PullQueue.pull()
      
      console.timeEnd "ping"

      console.log Cube.getCube()
