### define
model/binary/interpolation_collector : InterpolationCollector
model/binary/rasterizer : Rasterizer
model/game : Game
libs/simple_array_buffer_socket : SimpleArrayBufferSocket
libs/simple_worker : SimpleWorker
###

EPSILON = 1e-10
BUCKET_WIDTH = 1 << 5

loadingState = true

ZOOM_STEP_COUNT = 4


# #Model.Binary#
# Binary is the real deal.
# It loads and stores the primary graphical data.
# 
# ##Data structure##
#
# ###Concept###
# We store 3-dimensional data with each coordinate >= [0,0,0].
# Each point is stored in **buckets** which resemble a cubical grid. 
# Those buckets are kept in an expandable data structure (**cube**) which 
# represents the smallest cuboid covering all used buckets.
# 
# ###Implementation###
# Each point value (greyscale color) is represented by a number 
# between 0 and 1, where 0 is black and 1 white. 
# 
# The buckets are implemented as `Uint8Array`s with a length of
# `BUCKET_WIDTH ^ 3`. Each point can be easiliy found through simple 
# arithmetik (see `Model.Binary.pointIndex`). Each bucket has an 
# address which is its coordinate representation and can be computed 
# by (integer-)dividing each coordinate with `BUCKET_WIDTH`.
#
# We actually use bitwise operations to perform some of our 
# computations. Therefore `BUCKET_WIDTH` needs to be a power of 2.
# Also we consider a bucket to be either non-existant or full. There
# are no sparse buckets.
#
# The cube is defined by the offset `[x,y,z]` and size `[a,b,c]` 
# of the cuboid. Both refer to the address of the buckets. It is 
# actually just a standard javascript array with each item being 
# either `null`, `loadingState` or a bucket. The length of the
# array is `a * b * c`. Also finding the containing bucket of a point 
# can be done with pretty simple math (see `Model.Binary.bucketIndex`).
#
# ###Inserting###
# When inserting new data into the data structure we first need
# to make sure the cube is big enough to cover all buckets. Otherwise
# we'll have to expand the cube (see `Model.Binary.extendByBucketExtent`). 
# Then we just set the buckets.  
#
# ##Loading##
# We do attempt to preload buckets intelligently (see 
# `Model.Binary.ping`). We use a breadth-first search starting at
# the bucket to cursor is currently on. Then we look at its neigbors.
# For each neighbor we decide based on intersection with an spherical
# cap (implented by both a plane and a sphere), which resembles the
# canvas where the data is painted on later (see `Model.Trianglesplane`).
# 
# This helps us to load data in the direction of your current view. Also, 
# the preload algorithm creates an imaginary half-sphere which expands
# over time. So we should minimize the times user experience unloaded
# buckets.
#
# ##Querying##
# `Model.Binary.get` provides an interface to query the stored data.
# Give us an array of coordinates (vertices) and we'll give you the 
# corresponding color values. Actually, we provide you with the required
# data to perform your own interpolation (i.e. on the GPU). We apply 
# either a linear, bilinear or trilinear interpolation so the result 
# should be quite smooth. However, if one of the required 2, 4 or 8 points 
# is missing we'll decide that your requested point is missing aswell.
# 

# Macros

# Computes the bucket index of the vertex with the given coordinates.
# Requires `cubeOffset` and `cubeSize` to be in scope.
bucketIndexMacro = (x, y, z) ->

  ((x >> 5) - cubeOffset[0]) * cubeSize[2] * cubeSize[1] +
  ((y >> 5) - cubeOffset[1]) * cubeSize[2] + 
  ((z >> 5) - cubeOffset[2])

# Computes the bucket index of the given vertex.
# Requires `cubeOffset` and `cubeSize` to be in scope.
bucketIndexByVertexMacro = (vertex) ->

  ((vertex[0] >> 5) - cubeOffset[0]) * cubeSize[2] * cubeSize[1] +
  ((vertex[1] >> 5) - cubeOffset[1]) * cubeSize[2] + 
  ((vertex[2] >> 5) - cubeOffset[2])


# Computes the index of the specified bucket.
# Requires `cubeOffset` and `cubeSize` to be in scope.
bucketIndexByAddressMacro = (vertex) ->

  (vertex[0] - cubeOffset[0]) * cubeSize[2] * cubeSize[1] +
  (vertex[1] - cubeOffset[1]) * cubeSize[2] + 
  (vertex[2] - cubeOffset[2])

# Computes the bucket index of the vertex with the given coordinates.
# Requires `cubeOffset0`, `cubeOffset1`, `cubeOffset2`, `cubeSize2` and 
# `cubeSize21` to be precomputed and in scope.
bucketIndex2Macro = (x, y, z) ->

  ((x >> 5) - cubeOffset0) * cubeSize21 +
  ((y >> 5) - cubeOffset1) * cubeSize2 + 
  ((z >> 5) - cubeOffset2)

# Computes the index of the vertex with the given coordinates in
# its bucket.
pointIndexMacro = (x, y, z) ->
  
  ((x & 31) << 10) +
  ((y & 31) << 5) +
  ((z & 31))

Binary =
  Rasterizer : Rasterizer

  # This method allows you to query the data structure. Give us an array of
  # vertices and we'll give you the stuff you need to interpolate data.
  #
  # We'll figure out how many color values you need to do interpolation.
  # That'll be 1, 2, 4 or 8 values. They represent greyscale colors ranging from
  # 0 to 1. Additionally, you need three delta values xd, yd and zd which are in
  # the range from 0 to 1. Then you should be able to perform a trilinear 
  # interpolation. To sum up, you get 11 floating point values for each point.
  # We spilt those in three array buffers to have them used in WebGL shaders as 
  # vec4 and vec3 attributes.
  # 
  # While processing the data several errors can occur. Please note that 
  # processing of a point halts if any of the required color values is wrong.
  # You can determine any errors by examining the first value of each point.
  # Feel free to color code those errors as you wish.
  #
  # *   `-3`: negative coordinates given
  # *   `-2`: block currently loading
  # *   `-1`: block fault
  # *   `0`: black
  # *   `1`: white
  # 
  # Parameters:
  # 
  # *   `vertices` is a `Float32Array with the vertices you'd like to query. There
  # is no need for you to round the coordinates. Otherwise you'd have a nearest-
  # neighbor-interpolation, which isn't pretty and kind of wavey. Every three
  # elements (x,y,z) represent one vertex.
  #
  # Promise Parameters:
  # 
  # *   `buffer0` is a `Float32Array` with the first 4 color values of
  # each points. The first value would contain any error codes.
  # *   `buffer1` is a `Float32Array` with the second 4 color values of
  # each points.
  # *   `bufferDelta` is a `Float32Array` with the delta values.
  #

  get : (vertices, zoomStep) ->

    $.when(@getSync(vertices, zoomStep))

  # A synchronized implementation of `get`.
  getSync : (vertices, zoomStep) ->

    buffer0     = new Float32Array(vertices.length / 3 << 2)
    buffer1     = new Float32Array(vertices.length / 3 << 2)
    bufferDelta = new Float32Array(vertices.length)
    
    if (cube = @cubes[zoomStep])

      cubeSize = @cubeSizes[zoomStep]
      cubeOffset = @cubeOffsets[zoomStep]
      #{ cubeSize, cubeOffset } = @


      InterpolationCollector.bulkCollect(
        vertices,
        buffer0, buffer1, bufferDelta, 
        cube, cubeSize, cubeOffset
      )
      
    { buffer0, buffer1, bufferDelta }

  PING_DEBOUNCE_TIME : 500
  PING_THROTTLE_TIME : 500
  PRELOAD_STEPBACK : 10
  
  # Use this method to let us know when you've changed your spot. Then we'll try to 
  # preload some data. 
  #
  # Parameters:
  #
  # *   `matrix` is a 3-element array representing the point you're currently at
  # *   `direction` is a 3-element array representing the vector of the direction 
  # you look at
  #
  # No Callback Paramters
  ping : (matrix, zoomStep) ->

    @ping = _.throttle2(@pingImpl, @PING_THROTTLE_TIME)
    @ping(matrix, zoomStep)

  pingImpl : (matrix, zoomStep) ->

    console.log "ping"
    console.time "ping"

    SPHERE_RADIUS = 140
    PLANE_STEPBACK = 25
    LOOP_LIMIT = 60
    loopCounter = 0
    
    sphereCenterVertex  = M4x4.transformPointAffine(matrix, [0, 0, -SPHERE_RADIUS])
    sphereRadiusSquared = SPHERE_RADIUS * SPHERE_RADIUS

    planeNormal = new Float32Array(3)
    planeNormal[2] = 1
    M4x4.transformLineAffine(matrix, planeNormal, planeNormal)

    planeDistance = V3.dot(
      M4x4.transformPointAffine(matrix, [0, 0, -PLANE_STEPBACK]), 
      planeNormal
    )

    bucketCornerVertex = new Float32Array(3)
    currentAddress     = new Float32Array(3)
    neighborAddress    = new Float32Array(3)
    vectorBuffer       = new Float32Array(3)

    currentAddress[0]  = matrix[12] >> 5
    currentAddress[1]  = matrix[13] >> 5
    currentAddress[2]  = matrix[14] >> 5
    
    workingQueue = [ currentAddress ]
    visitedList  = {}

    if not @cubes[zoomStep] or not @cubes[zoomStep][@bucketIndexByAddress(currentAddress, zoomStep)]
      @extendByBucketAddress(currentAddress, zoomStep)

    while workingQueue.length and loopCounter < LOOP_LIMIT

      currentAddress = workingQueue.shift()
      currentAddressString = V3.toString(currentAddress)

      continue if visitedList[currentAddressString]

      loopCounter++

      unless @cubes[zoomStep][@bucketIndexByAddress(currentAddress, zoomStep)]
        @extendByBucketAddress(currentAddress, zoomStep)
        @pullBucket(currentAddress, zoomStep) 

      # fetching those neighbor buckets

      tempWorkingQueue0 = []
      tempWorkingQueue1 = []

      neighborAddress[2] = currentAddress[2] - 2
      while neighborAddress[2] <= currentAddress[2]
        neighborAddress[2]++

        neighborAddress[1] = currentAddress[1] - 2
        while neighborAddress[1] <= currentAddress[1]
          neighborAddress[1]++

          neighborAddress[0] = currentAddress[0] - 2
          while neighborAddress[0] <= currentAddress[0]
            neighborAddress[0]++

            # go skip yourself
            continue if neighborAddress[0] == currentAddress[0] and neighborAddress[1] == currentAddress[1] and neighborAddress[2] == currentAddress[2]

            # we we're here already
            continue if visitedList[V3.toString(neighborAddress)]

            frontCorners = 0
            backCorners  = 0

            for bucketCornerX in [0..1]
              for bucketCornerY in [0..1]
                for bucketCornerZ in [0..1]

                  bucketCornerVertex[0] = neighborAddress[0] << 5
                  bucketCornerVertex[1] = neighborAddress[1] << 5
                  bucketCornerVertex[2] = neighborAddress[2] << 5

                  bucketCornerVertex[0] = bucketCornerVertex[0] | 31 if bucketCornerX
                  bucketCornerVertex[1] = bucketCornerVertex[1] | 31 if bucketCornerY
                  bucketCornerVertex[2] = bucketCornerVertex[2] | 31 if bucketCornerZ

                  cornerPlaneDistance = planeDistance - V3.dot(planeNormal, bucketCornerVertex)

                  if cornerPlaneDistance < -EPSILON

                    subX = bucketCornerVertex[0] - sphereCenterVertex[0]
                    subY = bucketCornerVertex[1] - sphereCenterVertex[1]
                    subZ = bucketCornerVertex[2] - sphereCenterVertex[2]

                    cornerSphereDistance = sphereRadiusSquared - (subX * subX + subY * subY + subZ * subZ)

                    if cornerSphereDistance < -EPSILON
                      frontCorners++
                    else
                      backCorners++
                  else
                    backCorners++

            
            if frontCorners
              if backCorners  
                tempWorkingQueue0.push(V3.clone(neighborAddress)) 
              else
                tempWorkingQueue1.push(V3.clone(neighborAddress)) 

      workingQueue = workingQueue.concat(tempWorkingQueue0).concat(tempWorkingQueue1)      
      visitedList[currentAddressString] = true
          

    console.timeEnd("ping")
    return


  # Loads and inserts a bucket from the server into the cube.
  # Requires cube to be large enough to handle the loaded bucket.
  pullBucket : (address, zoomStep) ->

    console.log "pull", V3.toString(address)

    @cubes[zoomStep][@bucketIndexByAddress(address, zoomStep)] = loadingState

    vertex = V3.clone(address)
    vertex[0] = vertex[0] << 5
    vertex[1] = vertex[1] << 5
    vertex[2] = vertex[2] << 5

    @loadBucket(vertex, zoomStep).then(
      (colors) =>
        
        @cubes[zoomStep][@bucketIndexByVertex(vertex, zoomStep)] = colors

        console.error "wrong colors length", colors.length if colors.length != 1 << (5 * 3)

        $(window).trigger("bucketloaded", [vertex])

      =>
        @cubes[zoomStep][@bucketIndexByVertex(vertex, zoomStep)] = null
    )
  
  loadBucketSocket : _.once ->
    
    Game.initialize().pipe ->
      dataSetId = Game.dataSet.id
      new SimpleArrayBufferSocket(
        defaultSender : new SimpleArrayBufferSocket.WebSocket("ws://#{document.location.host}/binary/ws?dataSetId=#{dataSetId}&cubeSize=32")
        fallbackSender : new SimpleArrayBufferSocket.XmlHttpRequest("/binary/ajax?dataSetId=#{dataSetId}&cubeSize=32")
        requestBufferType : Float32Array
        responseBufferType : Uint8Array
      )
  
  loadBucket : (vertex, zoomStep) ->
    arr = new Float32Array(vertex.length + 1)
    arr[0] = zoomStep
    arr.set(vertex, 1)
    @loadBucketSocket().pipe (socket) -> socket.send(arr)

  
  # Now comes the implementation of our internal data structure.
  # `cube` is the main array. It actually represents a cuboid 
  # containing all the buckets. `cubeSize` and `cubeOffset` 
  # describe its dimension.
  cubes : []
  cubeSizes : []
  cubeOffsets : []

  # Retuns the index of the bucket (in the cuboid) which holds the
  # point you're looking for.
  bucketIndex : (x, y, z, zoomStep) ->
    
    cubeOffset = @cubeOffsets[zoomStep]
    cubeSize = @cubeSizes[zoomStep]

    bucketIndexMacro(x, y, z)

  bucketIndexByVertex : (vertex, zoomStep) ->

    cubeOffset = @cubeOffsets[zoomStep]
    cubeSize = @cubeSizes[zoomStep]

    bucketIndexByVertexMacro(vertex)

  bucketIndexByAddress : (address, zoomStep) ->

    cubeOffset = @cubeOffsets[zoomStep]
    cubeSize = @cubeSizes[zoomStep]

    bucketIndexByAddressMacro(address)

  
  # Returns the index of the point (in the bucket) you're looking for.
  pointIndex : (x, y, z) ->
    
    pointIndexMacro(x, y, z)

  # Want to add data? Make sure the cuboid is big enough.
  # This one is for passing real point coordinates.
  extendByExtent : ({ min_x, min_y, min_z, max_x, max_y, max_z }, zoomStep) ->
    
    @extendByBucketExtent(
      min_x >> 5,
      min_y >> 5,
      min_z >> 5,
      max_x >> 5,
      max_y >> 5,
      max_z >> 5,
      zoomStep
    )

  extendByPoint : ([ x, y, z ], zoomStep) ->
    @extendByBucketExtent(
      x >> 5,
      y >> 5,
      z >> 5,
      x >> 5,
      y >> 5,
      z >> 5,
      zoomStep
    )

  extendByBucketAddress : ([ x, y, z ], zoomStep) ->
    @extendByBucketExtent(x, y, z, x, y, z, zoomStep)
      
      
  # And this one is for passing bucket coordinates.
  extendByBucketExtent : (x0, y0, z0, x1, y1, z1, zoomStep) ->

    oldCube       = @cubes[zoomStep]
    oldCubeOffset = @cubeOffsets[zoomStep]
    oldCubeSize   = @cubeSizes[zoomStep]

    # First, we calculate the new dimension of the cuboid.
    if oldCube?
      oldUpperBound = new Uint32Array(3)
      oldUpperBound[0] = oldCubeOffset[0] + oldCubeSize[0]
      oldUpperBound[1] = oldCubeOffset[1] + oldCubeSize[1]
      oldUpperBound[2] = oldCubeOffset[2] + oldCubeSize[2]
      
      newCubeOffset = new Uint32Array(3)
      newCubeOffset[0] = Math.min(x0, x1, oldCubeOffset[0])
      newCubeOffset[1] = Math.min(y0, y1, oldCubeOffset[1])
      newCubeOffset[2] = Math.min(z0, z1, oldCubeOffset[2])
      
      newCubeSize = new Uint32Array(3)
      newCubeSize[0] = Math.max(x0, x1, oldUpperBound[0] - 1) - newCubeOffset[0] + 1
      newCubeSize[1] = Math.max(y0, y1, oldUpperBound[1] - 1) - newCubeOffset[1] + 1
      newCubeSize[2] = Math.max(z0, z1, oldUpperBound[2] - 1) - newCubeOffset[2] + 1
      

      # Just reorganize the existing buckets when the cube dimensions 
      # have changed. Transferring all old buckets to their new location.
      if newCubeOffset[0] != oldCubeOffset[0] or 
      newCubeOffset[1] != oldCubeOffset[1] or 
      newCubeOffset[2] != oldCubeOffset[2] or 
      newCubeSize[0] != oldCubeSize[0] or 
      newCubeSize[1] != oldCubeSize[1] or 
      newCubeSize[2] != oldCubeSize[2]

        newCube = new Array(newCubeSize[0] * newCubeSize[1] * newCubeSize[2])
        newIndex = 0

        for x in [0...newCubeSize[0]]

          if oldCubeOffset[0] <= x + newCubeOffset[0] < oldUpperBound[0]

            for y in [0...newCubeSize[1]]

              if oldCubeOffset[1] <= y + newCubeOffset[1] < oldUpperBound[1]

                for z in [0...newCubeSize[2]]

                  if oldCubeOffset[2] <= z + newCubeOffset[2] < oldUpperBound[2]
                    oldIndex = 
                      (x + newCubeOffset[0] - oldCubeOffset[0]) * oldCubeSize[2] * oldCubeSize[1] +
                      (y + newCubeOffset[1] - oldCubeOffset[1]) * oldCubeSize[2] +
                      (z + newCubeOffset[2] - oldCubeOffset[2])
                    newCube[newIndex] = oldCube[oldIndex]
                  newIndex++
              else
                newIndex += newCubeSize[2]

          else
            newIndex += newCubeSize[2] * newCubeSize[1]

        @cubes[zoomStep]       = newCube
        @cubeOffsets[zoomStep] = newCubeOffset
        @cubeSizes[zoomStep]   = newCubeSize

        # verify

        # throw "ouch" unless newIndex == newCube.length

        # for x in [newCubeOffset[0]...(newCubeOffset[0] + newCubeSize[0])]
        #   for y in [newCubeOffset[1]...(newCubeOffset[1] + newCubeSize[1])]
        #     for z in [newCubeOffset[2]...(newCubeOffset[2] + newCubeSize[2])]
              
        #         oldIndex =
        #           (x - oldCubeOffset[0]) * oldCubeSize[2] * oldCubeSize[1] +
        #           (y - oldCubeOffset[1]) * oldCubeSize[2] + 
        #           (z - oldCubeOffset[2])
              
        #         newIndex = 
        #           (x - newCubeOffset[0]) * newCubeSize[2] * newCubeSize[1] +
        #           (y - newCubeOffset[1]) * newCubeSize[2] + 
        #           (z - newCubeOffset[2])

        #       if (oldCubeOffset[0] <= x < oldUpperBound[0]) and
        #       (oldCubeOffset[1] <= y < oldUpperBound[1]) and
        #       (oldCubeOffset[2] <= z < oldUpperBound[2])
        #         throw "ouch" unless oldCube[oldIndex] == newCube[newIndex]
        #       else
        #         throw "ouch" unless newCube[newIndex] == undefined

    else
      # Before, there wasn't any cube.
      newCubeOffset = new Uint32Array(3)
      newCubeOffset[0] = Math.min(x0, x1)
      newCubeOffset[1] = Math.min(y0, y1)
      newCubeOffset[2] = Math.min(z0, z1)
      
      newCubeSize = new Uint32Array(3)
      newCubeSize[0] = Math.max(x0, x1) - newCubeOffset[0] + 1
      newCubeSize[1] = Math.max(y0, y1) - newCubeOffset[1] + 1
      newCubeSize[2] = Math.max(z0, z1) - newCubeOffset[2] + 1
      
      newCube = new Array(newCubeSize[0] * newCubeSize[1] * newCubeSize[2])

      @cubes[zoomStep]       = newCube
      @cubeOffsets[zoomStep] = newCubeOffset
      @cubeSizes[zoomStep]   = newCubeSize


  # Returns a color value from the data structure.
  # Color values range from 0 to 1 -- with black being 0 and white 1.
  getColor : (x, y, z, zoomstep) ->
    
    unless (cube = @cube[zoomStep])
      return 0

    cubeOffset = @cubeOffsets[zoomStep]
    cubeSize = @cubeSizes[zoomStep]

    bucket = cube[bucketIndexMacro(x, y, z)]
    
    if bucket
      bucket[pointIndexMacro(x, y, z)]
    else
      0

