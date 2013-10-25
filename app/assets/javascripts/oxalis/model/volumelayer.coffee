### define 
./dimensions : Dimensions
libs/drawing : Drawing
../constants : constants
###


class VolumeLayer

  MIN_DISTANCE : 2
  GRID_SIZE : 10
  
  constructor : (@plane, @thirdDimensionValue) ->
    
    @contourList = []
    @maxCoord    = null
    @minCoord    = null

  addContour : (pos) ->

    # If the distance to the last point is larger than MIN_DISTANCE,
    # interpolate so that the winding number alg. used in contains2dCoordinate
    # has enough points to be accurate
    if @contourList.length > 0
      last = @contourList[@contourList.length - 1]
      step = Math.min(@MIN_DISTANCE / @calculateDistance(last, pos), 1)
      for f in [step...1] by step
        hpos = @interpolatePositions( last, pos, f)
        @contourList.push(hpos)
        @updateArea(hpos)
    
    @contourList.push(pos)
    @updateArea(pos)


  updateArea : (pos) ->

    unless @maxCoord?
      @maxCoord = pos.slice()
      @minCoord = pos.slice()

    for i in [0..2]
      @minCoord[i] = Math.min(@minCoord[i], Math.floor(pos[i]) - 1)
      @maxCoord[i] = Math.max(@maxCoord[i], Math.ceil(pos[i]) + 1)


  getSmoothedContourList : ->

    return Drawing.smoothLine(@contourList, ( (pos) => @updateArea(pos) ) )


  getVoxelIterator : ->

    unless @minCoord
      return { hasNext : false }

    @addContour( @contourList[0] )

    minCoord2d = @get2DCoordinate(@minCoord)
    maxCoord2d = @get2DCoordinate(@maxCoord)
    width      = maxCoord2d[0] - minCoord2d[0] + 1
    height     = maxCoord2d[1] - minCoord2d[1] + 1
    
    map = new Array(width)
    for x in [0...width]
      map[x] = new Array(height)
      for y in [0...height]
        map[x][y] = false

    setMap = (x, y) ->

      x = Math.floor(x); y = Math.floor(y)
      map[x - minCoord2d[0]][y - minCoord2d[1]] = true

    to2DCoordinate = (x, y) ->

      return [x + minCoord2d[0] + 0.5, y + minCoord2d[1] + 0.5]


    @drawOutlineVoxels(setMap)

    @fillOutline(map, width, height, to2DCoordinate)

    iterator = {
      hasNext : true
      x : 0
      y : 0
      getNext : ->
        res = @get3DCoordinate([@x + minCoord2d[0], @y + minCoord2d[1]])
        while true
          @x = (@x + 1) % width
          if @x == 0 then @y++
          if map[@x][@y] or @y == height
            @hasNext = @y != height
            break
        return res
      initialize : ->
        if not map[0][0]
          @getNext()
      get3DCoordinate : (arg) => return @get3DCoordinate(arg)
    }
    iterator.initialize()

    return iterator


  drawOutlineVoxels : (setMap) ->

    for i in [0...@contourList.length]

      p1 = @get2DCoordinate(  @contourList[i]  )
      p2 = @get2DCoordinate(  @contourList[(i+1) % @contourList.length]  )
      
      Drawing.drawLine2d(p1[0], p1[1], p2[0], p2[1], setMap)


  fillOutline : (map, width, height, to2DCoordinate) ->

    setMap = (x, y) ->
      map[x][y] = true
    isEmpty = (x, y) ->
      return map[x][y] != true

    # Use a grid of points within the bounding box to flood fill
    # the area.
    for x in [0..(width - 1)] by Math.round(width / @GRID_SIZE)
      for y in [0..(height - 1)] by Math.round(height / @GRID_SIZE)
        if isEmpty(x, y) and @contains2dCoordinate( to2DCoordinate( x, y ))
          Drawing.fillArea(x, y, width, height, false, isEmpty, setMap)


  get2DCoordinate : (coord3d) ->
    # Throw out 'thirdCoordinate' which is equal anyways

    result = []
    for i in [0..2]
      if i != Dimensions.thirdDimensionForPlane(@plane)
        result.push(coord3d[i])
    return result


  get3DCoordinate : (coord2d) ->
    # Put thirdCoordinate back in
    index   = Dimensions.thirdDimensionForPlane(@plane)
    index2d = 0
    res     = [0, 0, 0]

    for i in [0..2]
      if i != index
        res[i] = coord2d[index2d++]
      else
        res[i] = @thirdDimensionValue

    return res


  contains2dCoordinate : (point, list = @contourList) ->
    
    # Algorithm described in OX-322
    totalDiff = 0

    for contour in list

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

    return totalDiff != 0


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


  calculateDistance : (p1, p2) ->

    diff = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]]
    return Math.sqrt( diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2])


  interpolatePositions : (pos1, pos2, f) ->

    sPos1 = [pos1[0] * (1 - f), pos1[1] * (1 - f), pos1[2] * (1 - f)]
    sPos2 = [pos2[0] * f, pos2[1] * f, pos2[2] * f]
    return [sPos1[0] + sPos2[0], sPos1[1] + sPos2[1], sPos1[2] + sPos2[2]]