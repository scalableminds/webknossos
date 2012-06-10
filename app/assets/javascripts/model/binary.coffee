### define
model/binary/interpolation_collector : InterpolationCollector
model/binary/polyhedron_rasterizer : PolyhedronRasterizer
model/game : Game
libs/simple_array_buffer_socket : SimpleArrayBufferSocket
libs/simple_worker : SimpleWorker
###

EPSILON = 1e-10
BUCKET_WIDTH = 1 << 5

LOADING_STATE = {}

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

# Computes the bucket index of the given vertex.
# Requires `cubeOffset` and `cubeSize` to be in scope.
bucketIndexByVertex3Macro = (x, y, z) ->

  ((x >> 5) - cubeOffset[0]) * cubeSize[2] * cubeSize[1] +
  ((y >> 5) - cubeOffset[1]) * cubeSize[2] + 
  ((z >> 5) - cubeOffset[2])


# Computes the index of the specified bucket.
# Requires `cubeOffset` and `cubeSize` to be in scope.
bucketIndexByAddress3Macro = (bucket_x, bucket_y, bucket_z) ->

  (bucket_x - cubeOffset[0]) * cubeSize[2] * cubeSize[1] +
  (bucket_y - cubeOffset[1]) * cubeSize[2] + 
  (bucket_z - cubeOffset[2])

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
  Rasterizer : PolyhedronRasterizer

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
    
    buffer = new Float32Array(vertices.length / 3)

    if (cube = @cubes[zoomStep])

      cubeSize = @cubeSizes[zoomStep]
      cubeOffset = @cubeOffsets[zoomStep]

      InterpolationCollector.bulkCollect(
        vertices, buffer
        cube, cubeSize, cubeOffset
      )

    buffer


  PULL_LIMIT : 5
  PING_THROTTLE_TIME : 200
  
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

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)
    @ping(matrix, zoomStep)


  pingPolyhedron : new PolyhedronRasterizer.Master([
      -3,-3,-1 #0
      -1,-1, 2 #3
      -3, 3,-1 #6
      -1, 1, 2 #9
       3,-3,-1 #12 
       1,-1, 2 #15
       3, 3,-1 #18
       1, 1, 2 #21
    ],[
      0,3
      0,6
      0,12
      3,9
      3,15
      6,9
      6,18
      9,21
      12,15
      12,18
      15,21
      18,21
    ])


  pingLastMatrix : null


  pingImpl : (matrix, zoomStep) ->

    unless _.isEqual(matrix, @pingLastMatrix)

      @pingLastMatrix = matrix

      console.time "ping"
      matrix = M4x4.clone(matrix)
      matrix[12] = matrix[12] >> 5
      matrix[13] = matrix[13] >> 5
      matrix[14] = matrix[14] >> 5

      polyhedron = @pingPolyhedron.transformAffine(matrix)

      @extendByBucketAddressExtent(polyhedron, zoomStep)

      cube = @cubes[zoomStep]

      polyhedron.prepare()
      testAddresses = polyhedron.collectPointsOnion(matrix[12], matrix[13], matrix[14])
      
      pullQueue = @pullQueue
      pullQueue.length = 0

      i = 0
      while i < testAddresses.length
        x = testAddresses[i++]
        y = testAddresses[i++]
        z = testAddresses[i++]

        address = [x, y, z]
        unless cube[@bucketIndexByAddress(address, zoomStep)]
          pullQueue.push x, y, z, zoomStep
          # @pullBucket(address, zoomStep)

      @pull()
      console.timeEnd "ping"

  pullQueue : []
  pullLoadingCount : 0

  pull : ->
    { pullQueue } = @
    while @pullLoadingCount < @PULL_LIMIT and pullQueue.length
      [x, y, z, zoomStep] = pullQueue.splice(0, 4)
      @pullBucket(x, y, z, zoomStep)



  # Loads and inserts a bucket from the server into the cube.
  # Requires cube to be large enough to handle the loaded bucket.
  pullBucket : (bucket_x, bucket_y, bucket_z, zoomStep) ->

    console.log "pull", bucket_x, bucket_y, bucket_z

    @cubes[zoomStep][@bucketIndexByAddress3(bucket_x, bucket_y, bucket_z, zoomStep)] = LOADING_STATE
    @pullLoadingCount++

    @loadBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep).then(
      (colors) =>
        
        @cubes[zoomStep][@bucketIndexByAddress3(bucket_x, bucket_y, bucket_z, zoomStep)] = colors

        $(window).trigger("bucketloaded", [[bucket_x, bucket_y, bucket_z]])

      =>
        @cubes[zoomStep][@bucketIndexByAddress3(bucket_x, bucket_y, bucket_z, zoomStep)] = null
    ).always =>
      @pullLoadingCount--
      @pull()

  
  loadBucketSocket : _.once ->
    
    Game.initialize().pipe ->
      dataSetId = Game.dataSet.id
      new SimpleArrayBufferSocket(
        defaultSender : new SimpleArrayBufferSocket.WebSocket("ws://#{document.location.host}/binary/ws?dataSetId=#{dataSetId}&cubeSize=32")
        fallbackSender : new SimpleArrayBufferSocket.XmlHttpRequest("/binary/ajax?dataSetId=#{dataSetId}&cubeSize=32")
        requestBufferType : Float32Array
        responseBufferType : Uint8Array
      )

  
  loadBucketByAddress : ([ bucket_x, bucket_y, bucket_z ], zoomStep) ->
    @loadBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep)

  loadBucketByAddress3 : (bucket_x, bucket_y, bucket_z, zoomStep) ->
    arr = [ zoomStep, bucket_x << 5, bucket_y << 5, bucket_z << 5 ]
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
  bucketIndexByVertex : (vertex, zoomStep) ->

    @bucketIndexByVertex3Macro(vertex[0], vertex[1], vertex[2], zoomStep)


  bucketIndexByVertex3 : (x, y, z, zoomStep) ->

    cubeOffset = @cubeOffsets[zoomStep]
    cubeSize = @cubeSizes[zoomStep]

    @bucketIndexByVertex3Macro(x, y, z, zoomStep)


  bucketIndexByAddress : (address, zoomStep) ->

    @bucketIndexByAddress3(address[0], address[1], address[2], zoomStep)

  bucketIndexByAddress3 : (bucket_x, bucket_y, bucket_z, zoomStep) ->

    cubeOffset = @cubeOffsets[zoomStep]
    cubeSize = @cubeSizes[zoomStep]

    bucketIndexByAddress3Macro(bucket_x, bucket_y, bucket_z)

  
  # Returns the index of the point (in the bucket) you're looking for.
  pointIndexByVertex : (vertex) ->
    
    pointIndexMacro(vertex[0], vertex[1], vertex[2])

  pointIndexByVertex3 : (x, y, z) ->
    
    pointIndexMacro(x, y, z)


  # Want to add data? Make sure the cuboid is big enough.
  # This one is for passing real point coordinates.
  extendByVertexExtent : ({ min_x, min_y, min_z, max_x, max_y, max_z }, zoomStep) ->
    
    @extendByBucketAddressExtent(
      min_x >> 5,
      min_y >> 5,
      min_z >> 5,
      max_x >> 5,
      max_y >> 5,
      max_z >> 5,
      zoomStep
    )


  extendByVertex : ([ x, y, z ], zoomStep) ->

    @extendByVertex3(x, y, z, zoomStep)

  extendByVertex3 : (x, y, z, zoomStep) ->
    
    bucket_x = x >> 5
    bucket_y = y >> 5
    bucket_z = z >> 5

    @extendByBucketAddressExtent(
      bucket_x,
      bucket_y,
      bucket_z,
      bucket_x,
      bucket_y,
      bucket_z,
      zoomStep
    )

  extendByBucketAddress : ([ x, y, z ], zoomStep) ->

    @extendByBucketAddressExtent(x, y, z, x, y, z, zoomStep)
      
  extendByBucketAddressExtent : ({ min_x, min_y, min_z, max_x, max_y, max_z }, zoomStep) ->  

    @extendByBucketAddressExtent6(min_x, min_y, min_z, max_x, max_y, max_z, zoomStep)  
  
  # And this one is for passing bucket coordinates.
  extendByBucketAddressExtent6 : (min_x, min_y, min_z, max_x, max_y, max_z, zoomStep) ->

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
      newCubeOffset[0] = Math.min(min_x, max_x, oldCubeOffset[0])
      newCubeOffset[1] = Math.min(min_y, max_y, oldCubeOffset[1])
      newCubeOffset[2] = Math.min(min_z, max_z, oldCubeOffset[2])
      
      newCubeSize = new Uint32Array(3)
      newCubeSize[0] = Math.max(min_x, max_x, oldUpperBound[0] - 1) - newCubeOffset[0] + 1
      newCubeSize[1] = Math.max(min_y, max_y, oldUpperBound[1] - 1) - newCubeOffset[1] + 1
      newCubeSize[2] = Math.max(min_z, max_z, oldUpperBound[2] - 1) - newCubeOffset[2] + 1
      

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
      newCubeOffset[0] = Math.min(min_x, max_x)
      newCubeOffset[1] = Math.min(min_y, max_y)
      newCubeOffset[2] = Math.min(min_z, max_z)
      
      newCubeSize = new Uint32Array(3)
      newCubeSize[0] = Math.max(min_x, max_x) - newCubeOffset[0] + 1
      newCubeSize[1] = Math.max(min_y, max_y) - newCubeOffset[1] + 1
      newCubeSize[2] = Math.max(min_z, max_z) - newCubeOffset[2] + 1
      
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

