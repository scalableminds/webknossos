### define 
./dimensions : Dimensions
###

PLANE_XY         = Dimensions.PLANE_XY
PLANE_YZ         = Dimensions.PLANE_YZ
PLANE_XZ         = Dimensions.PLANE_XZ

class VolumeLayer
  
  constructor : (@plane, @thirdDimensionValue, @id, @time) ->
    
    unless @time?
      @time = (new Date()).getTime()
    @contourList = []
    @comment     = ""
    #@plane       = null
    @maxCoord    = null
    @minCoord    = null

  addContour : (pos) ->
    @contourList.push(pos)

    unless @maxCoord?
      @maxCoord = pos.slice()
      @minCoord = pos.slice()

    for i in [0..2]
      @minCoord[i] = Math.min(@minCoord[i], pos[i])
      @maxCoord[i] = Math.max(@maxCoord[i], pos[i])

    # Automatically determine the plane, assuming
    # that for at least one pos, both of the other
    # coordinates will be different from the first
    # position
    
    #unless @firstPos
    #  @firstPos = pos.slice() 

    #if @prevPos
    #  equalDims = []
      
    #  for dim in [0..2]
    #    if pos[dim] == @prevPos[dim]
    #      equalDims.push(dim)
      
    #  if equalDims.length == 1
    #    @plane = Dimensions.planeForThirdDimension(equalDims[0])
    #    @thirdDimensionValue = pos[equalDims[0]]

  containsVoxel : (voxelCoordinate) ->
    
    thirdDimension = Dimensions.thirdDimensionForPlane(@plane)
    if voxelCoordinate[thirdDimension] != @thirdDimensionValue
      return false

     # Algorithm described in OX-322
    totalDiff = 0
    point = @get2DCoordinate(voxelCoordinate)

    for contour in @contourList

      contour2d = @get2DCoordinate(contour)
      newQuadrant = @getQuadrantWithRespectToPoint(contour2d, point)
      prevQuadrant = if quadrant? then quadrant else newQuadrant
      quadrant = newQuadrant
      
      if Math.abs(prevQuadrant - quadrant) == 2 or quadrant == 0
        # point is on the edge, considered within the polygon
        #console.log "Point is ON the edge", prevQuadrant, quadrant
        return true
      diff = quadrant - prevQuadrant
      # special cases if quadrants are 4 and 1
      if diff ==  3 then diff = -1
      if diff == -3 then diff =  1
      totalDiff -= diff

      #if prevQuadrant != quadrant
      #  console.log prevQuadrant, "-->", quadrant
      

    #console.log "totalDiff", totalDiff
    return totalDiff != 0

  getVoxelArray : ->

    res = []
    # Check every voxel in this cuboid
    startTime = new Date().getTime()
    for x in [@minCoord[0]..@maxCoord[0]]
      for y in [@minCoord[1]..@maxCoord[1]]
        for z in [@minCoord[2]..@maxCoord[2]]
          if @containsVoxel([x, y, z])
            res.push([x, y, z])
    console.log "Time", (new Date().getTime() - startTime)
    console.log "Cuboid", @minCoord, @maxCoord

    return res

  get2DCoordinate : (coord3d) ->
    # Throw out 'thirdCoordinate' which is equal anyways

    result = []
    for i in [0..2]
      if i != Dimensions.thirdDimensionForPlane(@plane)
        result.push(coord3d[i])
    return result

  getQuadrantWithRespectToPoint : (vertex, point) ->
    xDiff = vertex[0] - point[0]
    yDiff = vertex[1] - point[1]

    if xDiff == 0 and yDiff == 0
      # Vertex and point have the same coordinates
      return 0
    
    switch
      when xDiff <= 0 and yDiff >  0 then return 1
      when xDiff <= 0 and yDiff <= 0 then return 2
      when xDiff >  0 and yDiff <= 0 then return 3
      when xDiff >  0 and yDiff >  0 then return 4