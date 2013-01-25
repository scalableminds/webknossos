### define 
./dimensions : DimensionsHelper
###

PLANE_XY         = Dimensions.PLANE_XY
PLANE_YZ         = Dimensions.PLANE_YZ
PLANE_XZ         = Dimensions.PLANE_XZ

class VolumeLayer
  
  constructor : (@plane, @thirdDimensionValue, @time) ->
    
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
      if Math.abs(prevQuadrant - quadrant) > 1 or quadrant == 0
        # point is on the edge, considered within the polygon
        return true
      totalDiff += quadrant - prevQuadrant

    return totalDiff != 0

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
    
    switch
      when xDiff < 0 and yDiff > 0 then return 1
      when xDiff < 0 and yDiff < 0 then return 2
      when xDiff > 0 and yDiff < 0 then return 3
      when xDiff > 0 and yDiff > 0 then return 4

    # Now, vertex and point have the same coordinates
    return 0