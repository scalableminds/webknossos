### define
model/binary/interpolation_collector : InterpolationCollector
model/binary/polyhedron_rasterizer : PolyhedronRasterizer
model/binary/cube : Cube
model/game : Game
libs/simple_array_buffer_socket : SimpleArrayBufferSocket
libs/simple_worker : SimpleWorker
###

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
# between 0 and 255, where 0 is black and 255 white. 
# 
# The buckets are implemented as `Uint8Array`s with a length of
# `BUCKET_WIDTH ^ 3`. Each point can be easiliy found through simple 
# arithmetic (see `Model.Binary.pointIndexByVertex`). Each bucket has an 
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
# can be done with pretty simple math (see 
# `Model.Binary.bucketIndexByVertex`).
#
# Currently, we store separate sets of data for each zoom level.
#
# ###Inserting###
# When inserting new data into the data structure we first need
# to make sure the cube is big enough to cover all buckets. Otherwise
# we'll have to expand the cube (see `Model.Binary.extendByAddressExtent`). 
# Then we just set the buckets.  
#
# ##Loading##
# We do attempt to preload buckets intelligently (see 
# `Model.Binary.ping`). Using the camera matrix we use a transformed 
# preview volume (currently a cuboid) to determine which buckets are
# relevant to load right now. Those buckets are then enumerated starting
# with the current center of projection. They are used to populate a
# download queue, so 5 buckets can be loaded at a time.
# Once a new `Model.Binary.ping` is executed, the queue will be cleared
# again. This algorithm ensures the center bucket to be loaded first always.
#
# ##Querying##
# `Model.Binary.get` provides an interface to query the stored data.
# Give us an array of coordinates (vertices) and we'll give you the 
# corresponding color values. We apply either a linear, bilinear or 
# trilinear interpolation so the result should be quite smooth. However, 
# if one of the required 2, 4 or 8 points is missing we'll decide that 
# your requested point can't be valid aswell.
# 

Binary =

  # Constants
  PULL_DOWNLOAD_LIMIT : 5
  PING_THROTTLE_TIME : 200


  # This method allows you to query the data structure. Give us an array of
  # vertices and we'll the interpolated data.
  # 
  # Invalid points will have the value 0.
  get : (vertices, zoomStep) ->

    $.when(@getSync(vertices, zoomStep))


  # A synchronized implementation of `get`. Cuz its faster.
  getSync : (vertices, zoomStep) ->
    
    buffer = new Float32Array(vertices.length / 3)

    if cubeData = Cube.getSubCubeByZoomStep(zoomStep)

      { cube, cubeSize, cubeOffset } = cubeData

      InterpolationCollector.bulkCollect(
        vertices, buffer
        cube, cubeSize, cubeOffset
      )

    buffer


  # This is the preview volume for preloading data.
  pingPolyhedron : new PolyhedronRasterizer.Master([
      -3,-3,-1 #0
      -1,-1, 4 #3
      -3, 3,-1 #6
      -1, 1, 4 #9
       3,-3,-1 #12 
       1,-1, 4 #15
       3, 3,-1 #18
       1, 1, 4 #21
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

  # Use this method to let us know when you've changed your spot. Then we'll try to 
  # preload some data. 
  ping : (matrix, zoomStep) ->

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)
    @ping(matrix, zoomStep)
  

  pingImpl : (matrix, zoomStep) ->

    unless _.isEqual(matrix, @pingLastMatrix)

      @pingLastMatrix = matrix

      console.time "ping"

      # Transform vertex coordinates into bucket addresses.
      matrix = M4x4.clone(matrix)
      matrix[12] = matrix[12] >> 5
      matrix[13] = matrix[13] >> 5
      matrix[14] = matrix[14] >> 5

      polyhedron = @pingPolyhedron.transformAffine(matrix)

      Cube.extendByBucketAddressExtent(polyhedron, zoomStep)

      testAddresses = polyhedron.collectPointsOnion(matrix[12], matrix[13], matrix[14])
      
      pullQueue = @pullQueue
      pullQueue.length = 0

      i = 0
      while i < testAddresses.length
        bucket_x = testAddresses[i++]
        bucket_y = testAddresses[i++]
        bucket_z = testAddresses[i++]

        # Just adding bucket addresses we don't have.
        unless Cube.isBucketSetByAddress3(bucket_x, bucket_y, bucket_z, zoomStep)
          pullQueue.push bucket_x, bucket_y, bucket_z, zoomStep

      @pull()
      console.timeEnd "ping"

  
  pullQueue : []
  pullLoadingCount : 0

  # Eating up the pull queue and triggers downloading buckets.
  pull : ->
    
    { pullQueue, PULL_DOWNLOAD_LIMIT } = @

    while @pullLoadingCount < PULL_DOWNLOAD_LIMIT and pullQueue.length

      [x, y, z, zoomStep] = pullQueue.splice(0, 4)
      @pullBucket(x, y, z, zoomStep)

    return



  # Loads and inserts a bucket from the server into the cube.
  # Requires cube to be large enough to handle the loaded bucket.
  pullBucket : (bucket_x, bucket_y, bucket_z, zoomStep) ->

    Cube.setBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep, Cube.LOADING_PLACEHOLDER_OBJECT)
    @pullLoadingCount++

    @loadBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep).then(

      (colors) =>
        
        Cube.setBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep, colors)

        $(window).trigger("bucketloaded", [[bucket_x, bucket_y, bucket_z]])

      =>
        Cube.setBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep, null)

    ).always =>

      @pullLoadingCount--
      @pull()

  
  # This is an abstraction of the transport medium.
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

    transmitBuffer = [ zoomStep, bucket_x << 5, bucket_y << 5, bucket_z << 5 ]
    @loadBucketSocket().pipe (socket) -> socket.send(transmitBuffer)

