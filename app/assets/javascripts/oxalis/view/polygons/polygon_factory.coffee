### define
./tlt : tlt
###

# This class is capable of turning voxel data into triangles
# Based on the marching cubes algorithm
class PolygonFactory

  constructor : (@modelCube) ->

    @cubeSize = 3

  getTriangles : (min, max, id) ->

    triangles = []

    for x in [(min[0] - 1)...(max[0] + 3)] by @cubeSize
      for y in [(min[1] - 1)...(max[1] + 3)] by @cubeSize
        for z in [(min[2] - 1)...(max[2] + 3)] by @cubeSize

          cubeIndex = 0
          for i in [0..7]
            bit = if @isInSolid(x, y, z, i, id) then 1 else 0
            cubeIndex |= bit << i

          triangles = triangles.concat( tlt[ cubeIndex ] )

  isInSolid : (x, y, z, vertex, id) ->

    switch vertex
      when 0 then voxel = [x, y, z]
      when 1 then voxel = [x + @cubeSize, y, z]
      when 2 then voxel = [x + @cubeSize, y, z + @cubeSize]
      when 3 then voxel = [x, y, z + @cubeSize]
      when 4 then voxel = [x, y + @cubeSize, z]
      when 5 then voxel = [x + @cubeSize, y + @cubeSize, z]
      when 6 then voxel = [x + @cubeSize, y + @cubeSize, z + @cubeSize]
      when 7 then voxel = [x, y + @cubeSize, z + @cubeSize]

    return @modelCube.getLabel( voxel ) == id