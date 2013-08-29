### define 
./dimensions : Dimensions
libs/drawing : Drawing
../constants : constants
###


class VolumeLayer
  
  constructor : (@plane, @thirdDimensionValue) ->
    
    @contourList = []
    @maxCoord    = null
    @minCoord    = null

  addContour : (pos) ->
    
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

      x = Math.round(x); y = Math.round(y)
      map[x - minCoord2d[0]][y - minCoord2d[1]] = true


    @drawOutlineVoxels(setMap)

    @fillOutline(map, width, height)

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


  fillOutline : (map, width, height) ->

    setMap = (x, y) ->
      map[x][y] = true
    isEmpty = (x, y) ->
      return map[x][y] != true

    y = Math.round(height / 2)
    for x in [1...width]
      if not isEmpty(x-1, y) and isEmpty(x, y)
        break

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