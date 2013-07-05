### define
./tlt : tlt
###

# This class is capable of turning voxel data into triangles
# Based on the marching cubes algorithm
class PolygonFactory

  constructor : (@modelCube) ->

    @cubeOffset = 2

  getTriangles : (min, max) ->

    result = {}

    for x in [(min[0] - 1)...(max[0] + 3)] by @cubeOffset
      for y in [(min[1] - 1)...(max[1] + 3)] by @cubeOffset
        for z in [(min[2] - 1)...(max[2] + 3)] by @cubeOffset

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

    return result

  getCubeIndices : (x, y, z) ->

    labels = [
      @modelCube.getLabel( [x, y, z]                                             ),
      @modelCube.getLabel( [x + @cubeOffset, y, z]                               ),
      @modelCube.getLabel( [x + @cubeOffset, y, z + @cubeOffset]                 ),
      @modelCube.getLabel( [x, y, z + @cubeOffset]                               ),
      @modelCube.getLabel( [x, y + @cubeOffset, z]                               ),
      @modelCube.getLabel( [x + @cubeOffset, y + @cubeOffset, z]                 ),
      @modelCube.getLabel( [x + @cubeOffset, y + @cubeOffset, z + @cubeOffset]   ),
      @modelCube.getLabel( [x, y + @cubeOffset, z + @cubeOffset]                 ) ]

    cellIds = []
    for label in labels
      unless label in cellIds or label == 0
        cellIds.push( label )

    result = {}
    for cellId in cellIds
      cubeIndex = 0
      
      for i in [0..7]
        bit = if cellId == labels[i] then 1 else 0
        cubeIndex |= bit << i
      
      result[cellId] = cubeIndex

    return result
