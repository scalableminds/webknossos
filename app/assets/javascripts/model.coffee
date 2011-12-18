class _Model extends EventEmitter

  constructor : (skipInitialization) ->
    super
    @masterPolygon = new CSG()
    @polygonBuckets = []
    @pointBuckets = []
    @coordsCache = []

    unless skipInitialization
      binary_request("/binary/model/cube", (err, data) =>
        if err
          @emit('error', err)
        else
          @coordinatesModel = new Int8Array(data)
          @emit('initialized')
      )
    else
      @emit('initialized')
 
  rotateAndMove : (moveVector, axis, callback) ->
    
    # orthogonal vector to (0,1,0) and rotation vector
    ortho = Math.normalizeVector([axis[2], 0, -axis[0]])
    # dot product of (0,1,0) and rotation
    dotProd = axis[1]
    
    # transformation of dot product for cosA
    cosA = dotProd / Math.sqrt(Math.square(axis[0]) + Math.square(axis[1]) + Math.square(axis[2]))
    sinA = Math.sqrt(1 - Math.square(cosA))
    
    # calculate rotation matrix
    a00 = cosA + Math.square(ortho[0]) * (1 - cosA)
    a01 = -ortho[2] * sinA
    a02 = ortho[0] * ortho[2] * (1 - cosA)
    
    a10 = ortho[2] * sinA
    a11 = cosA
    a12 = -ortho[0] * sinA
    
    a20 = ortho[0] * ortho[2] * (1 - cosA)
    a21 = ortho[0] * sinA
    a22 = cosA + Math.square(ortho[2]) * (1 - cosA)
    
    # 
    output = new Int8Array(new ArrayBuffer(@coordinatesModel.byteLength))
    for i in [0...@coordinatesModel.length] by 3
      px = @coordinatesModel[i]
      py = @coordinatesModel[i + 1]
      pz = @coordinatesModel[i + 2]
      
      # see rotation matrix and helmert-transformation for more details
      output[i]     = Math.round(moveVector[0] + (a00 * px + a01 * py + a02 * pz))
      output[i + 1] = Math.round(moveVector[1] + (a10 * px + a11 * py + a12 * pz))
      output[i + 2] = Math.round(moveVector[2] + (a20 * px + a21 * py + a22 * pz))
    
    # clear stack before returning callback
    Utils.defer -> callback(null, output)
  
  get : (position, direction, callback) ->
    @load(position, direction, (err, colors) =>
      if err
        callback(err)
      else
        @rotateAndMove(position, direction, (err, coords) ->
          if err
            callback(err)
          else
            callback(null, coords, colors)
        )
    )

  load : (point, direction, callback) ->
    binary_request(
      "/binary/data/cube?px=#{point[0]}&py=#{point[1]}&pz=#{point[2]}&ax=#{direction[0]}&ay=#{direction[1]}&az=#{direction[2]}", 
      (err, data) ->
        if err
          callback(err)
        else
          callback(null, new Uint8Array(data))
    )
  

Model = new _Model()