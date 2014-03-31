### define
./tlt : tlt
###

# This class is capable of turning voxel data into triangles
# Based on the marching cubes algorithm
class PolygonFactory

  constructor : (@modelCube, min, max, @id) ->

    @samples    = 100
    @cubeOffset = Math.ceil((max[0] - min[0]) / @samples) || 1
    @chunkSize  = 10000

    [ @startX, @endX ] = [ min[0] - 1, max[0] + 3 ]
    [ @startY, @endY ] = [ min[1] - 1, max[1] + 3 ]
    [ @startZ, @endZ ] = [ min[2] - 1, max[2] + 3 ]


  getTriangles : () ->

    result    = {}
    @deferred = new $.Deferred()

    setTimeout( @calculateTrianglesAsync, 0, result )
    return @deferred


  calculateTrianglesAsync : (result, _x, _y, _z) =>

    i = 0

    x = @startX
    while x < @endX
      y = @startY
      while y < @endY
        z = @startZ
        while z < @endZ

          if ++i == 1 and _z?
            [x, y, z] = [_x, _y, _z]
            continue

          cubeIndices = @getCubeIndices(x, y, z)

          for cellId of cubeIndices

            unless result[cellId]?
              result[ cellId ] = []

            if cubeIndices[ cellId ] % 255 == 0
              continue

            newTriangles = []

            for triangle in tlt[ cubeIndices[ cellId ] ]
              newTriangle = []

              for vertex in triangle
                newTriangle.push( [ vertex[0] * @cubeOffset + x,
                                    vertex[1] * @cubeOffset + y,
                                    vertex[2] * @cubeOffset + z ] )

              newTriangles.push(newTriangle)

            result[ cellId ] = result[ cellId ].concat( newTriangles )

          # If chunk size is reached, pause execution
          if i == @chunkSize
            setTimeout( @calculateTrianglesAsync, 0, result, x, y, z)
            return

          z += @cubeOffset
        y += @cubeOffset
      x += @cubeOffset

    @deferred.resolve( result )


  getCubeIndices : (x, y, z) ->

    labels = [
      @modelCube.getDataValue( [x, y, z]                                             ),
      @modelCube.getDataValue( [x + @cubeOffset, y, z]                               ),
      @modelCube.getDataValue( [x + @cubeOffset, y, z + @cubeOffset]                 ),
      @modelCube.getDataValue( [x, y, z + @cubeOffset]                               ),
      @modelCube.getDataValue( [x, y + @cubeOffset, z]                               ),
      @modelCube.getDataValue( [x + @cubeOffset, y + @cubeOffset, z]                 ),
      @modelCube.getDataValue( [x + @cubeOffset, y + @cubeOffset, z + @cubeOffset]   ),
      @modelCube.getDataValue( [x, y + @cubeOffset, z + @cubeOffset]                 ) ]

    cellIds = []
    for label in labels
      unless label in cellIds or label == 0 or (@id? and @id != label)
        cellIds.push( label )

    result = {}
    for cellId in cellIds
      cubeIndex = 0

      for i in [0..7]
        bit = if cellId == labels[i] then 1 else 0
        cubeIndex |= bit << i

      result[cellId] = cubeIndex

    return result
