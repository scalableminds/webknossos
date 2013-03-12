### define 
./dimensions : Dimensions
###

PLANE_XY         = Dimensions.PLANE_XY
PLANE_YZ         = Dimensions.PLANE_YZ
PLANE_XZ         = Dimensions.PLANE_XZ

MODE_NORMAL      = 0
MODE_SUB         = 1
MODE_ADD         = 2

class VolumeLayer
  
  constructor : (@cell, @plane, @thirdDimensionValue, @id, @time) ->
    
    unless @time?
      @time = (new Date()).getTime()
    @contourList = []
    @helperList  = []         # used to implement add/substract
    @comment     = ""
    @maxCoord    = null
    @minCoord    = null
    @mode        = MODE_NORMAL

  setMode : (newMode) ->
    @mode = newMode
    @helperList = []

  addContour : (pos) ->
    if @mode == MODE_NORMAL
      @contourList.push(pos)
    else
      @helperList.push(pos)

    unless @maxCoord?
      @maxCoord = pos.slice()
      @minCoord = pos.slice()

    for i in [0..2]
      @minCoord[i] = Math.min(@minCoord[i], pos[i])
      @maxCoord[i] = Math.max(@maxCoord[i], pos[i])

  # Finalize add / substract
  finishLayer : ->

    if @mode == MODE_NORMAL then return

    # Intersect contourList with helperList
    cIn = []; cOut = []; isIn = null
    
    for pos in @contourList
      newIsIn = @containsVoxel(pos, @helperList)
      list = if newIsIn then cIn else cOut

      if isIn != newIsIn
        list.push([])
      list[ list.length - 1 ].push(pos)
      isIn = newIsIn

    # Intersect helperList with contourList
    hIn = []; hOut = []; isIn = null
    
    for pos in @helperList
      newIsIn = @containsVoxel(pos)
      list = if newIsIn then hIn else hOut

      if isIn != newIsIn
        list.push([])
      list[ list.length - 1 ].push(pos)
      isIn = newIsIn

    # newContourList contains cOut and either
    # hOut (MODE_ADD) or hIn (MODE_SUB)
    if @mode == MODE_ADD then partsList = cOut.concat(hOut)
    if @mode == MODE_SUB then partsList = cOut.concat(hIn)

    # Construct newContourList by putting the parts together
    newContourList = partsList.splice(0,1)[0]
    while partsList.length > 0
      pos = newContourList[newContourList.length - 1]
      closestPart = {
        distance  : Dimensions.distance(partsList[0][0], pos)
        partIndex : 0,
        reversed  : false 
      }

      for i in [0...partsList.length]
        list = partsList[i]

        for reversed in [true, false]
          index = if reversed then list.length - 1 else 0
          distance = Dimensions.distance(list[index], pos)

          if distance < closestPart.distance
            closestPart.distance  = distance
            closestPart.partIndex = i
            closestPart.reversed  = reversed

      partToAdd = partsList.splice(closestPart.partIndex, 1)[0]
      if closestPart.reversed
        partToAdd.reverse()
      newContourList = newContourList.concat(partToAdd)

    @contourList = newContourList.concat([newContourList[0]])
    @mode = MODE_NORMAL

  containsVoxel : (voxelCoordinate, list = @contourList) ->
    
    thirdDimension = Dimensions.thirdDimensionForPlane(@plane)
    if voxelCoordinate[thirdDimension] != @thirdDimensionValue
      return false

    return @contains2dCoordinate( @get2DCoordinate(voxelCoordinate), list )

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

  getVoxelArray : ->

    minCoord2d = @get2DCoordinate(@minCoord)
    maxCoord2d = @get2DCoordinate(@maxCoord)
    width      = maxCoord2d[0] - minCoord2d[0] + 1
    height     = maxCoord2d[1] - minCoord2d[1] + 1

    start = new Date().getTime()
    
    map = new Array(width)
    for x in [0...width]
      map[x] = new Array(height)
      for y in [0...height]
        map[x][y] = false

    @getOutlineVoxels(map)

    res = []
    # Check every voxel in this cuboid
    #startTime = new Date().getTime()
    #for x in [@minCoord[0]..@maxCoord[0]]
    #  for y in [@minCoord[1]..@maxCoord[1]]
    #    for z in [@minCoord[2]..@maxCoord[2]]
    #      if @containsVoxel([x, y, z])
    #        res.push([x, y, z])
    #for p in outline
    #  res.push(@get3DCoordinate(p))
    for x in [0...width]
      for y in [0...height]
        if map[x][y]
          res.push(@get3DCoordinate([x + minCoord2d[0], y + minCoord2d[1]]))

    #console.log(res)
    return res

  getOutlineVoxels : (map) ->

    start = new Date().getTime()

    # Get first voxel within layer
    minCoord2d = @get2DCoordinate(@minCoord)
    maxCoord2d = @get2DCoordinate(@maxCoord)
    offsetX    = minCoord2d[0]
    offsetY    = minCoord2d[1]
    p = [ Math.round((minCoord2d[0] + maxCoord2d[0]) / 2),
          minCoord2d[1] ]
    while not @contains2dCoordinate(p)
      p[1]++

    # Set up directions
    directionRight = { xDiff :  1, yDiff :  0}
    directionDown  = { xDiff :  0, yDiff :  1}
    directionLeft  = { xDiff : -1, yDiff :  0}
    directionUp    = { xDiff :  0, yDiff : -1}
    directions     = [directionRight, directionDown,
                      directionLeft, directionUp]

    # Some helper methods
    directionIndex = 0
    direction = directions[directionIndex]
    nextDir = ->
      directionIndex = (directionIndex + 1) % 4
      return direction = directions[directionIndex]
    prevDir = ->
      directionIndex = (directionIndex + 3) % 4
      return direction = directions[directionIndex]
    applyDir = (point) ->
      return [point[0] + direction.xDiff, point[1] + direction.yDiff]

    console.log "Before loop", new Date().getTime() - start
    start = new Date().getTime()

    inCount = 0
    while inCount < 10
      if map[p[0] - offsetX][p[1] - offsetY]
        inCount++
      else
        inCount = 0
        map[p[0] - offsetX][p[1] - offsetY] = true
      prevDir()
      while not @contains2dCoordinate( applyDir(p) )
        nextDir()
      p = applyDir(p)

    console.log "After Loop", new Date().getTime() - start
    start = new Date().getTime()


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
    res     = []

    for i in [0..2]
      if i != index
        res.push(coord2d[index2d++])
      else
        res.push(@thirdDimensionValue)

    return res

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