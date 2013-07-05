### define
./tlt : tlt
###

# This class is capable of turning voxel data into triangles
# Based on the marching cubes algorithm
class PolygonFactory

  constructor : (@modelCube) ->

    @cubeOffset = 2

  getTriangles : (min, max, id) ->

    triangles = []

    for x in [(min[0] - 1)...(max[0] + 3)] by @cubeOffset
      for y in [(min[1] - 1)...(max[1] + 3)] by @cubeOffset
        for z in [(min[2] - 1)...(max[2] + 3)] by @cubeOffset

          cubeIndex = 0
          for i in [0..7]
            bit = if @isInSolid(x, y, z, i, id) then 1 else 0
            cubeIndex |= bit << i

          if cubeIndex == 0 or cubeIndex == 255
            continue

          newTriangles = []

          for triangle in tlt[ cubeIndex ]
            newTriangle = []

            for vertex in triangle
              newTriangle.push( [ vertex[0] * @cubeOffset + x,
                                  vertex[1] * @cubeOffset + y,
                                  vertex[2] * @cubeOffset + z ] )
            
            newTriangles.push(newTriangle)

          triangles = triangles.concat( newTriangles )

    return triangles

  isInSolid : (x, y, z, vertex, id) ->

    switch vertex
      when 0 then voxel = [x, y, z]
      when 1 then voxel = [x + @cubeOffset, y, z]
      when 2 then voxel = [x + @cubeOffset, y, z + @cubeOffset]
      when 3 then voxel = [x, y, z + @cubeOffset]
      when 4 then voxel = [x, y + @cubeOffset, z]
      when 5 then voxel = [x + @cubeOffset, y + @cubeOffset, z]
      when 6 then voxel = [x + @cubeOffset, y + @cubeOffset, z + @cubeOffset]
      when 7 then voxel = [x, y + @cubeOffset, z + @cubeOffset]

    return @modelCube.getLabel( voxel ) == id