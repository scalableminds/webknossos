describe 'geometry', ->
  g = null
  beforeEach ->
    g = new Geometry()
    g.load([
      [[2,0,0],[2,2,0],[0,2,0],[0,0,0]],
      [[0,0,0],[0,0,2],[2,0,2],[2,0,0]],
      [[0,2,0],[0,2,2],[0,0,2],[0,0,0]],
      [[0,0,2],[0,2,2],[2,2,2],[2,0,2]],
      [[2,2,0],[2,2,2],[0,2,2],[0,2,0]],
      [[2,0,0],[2,0,2],[2,2,2],[2,2,0]]
    ])
    
   
  it 'should load a polyhedron', ->
    expect(g.polyhedral.length).toEqual(1)
    expect(g.polyhedral[0].vertices.length).toEqual(8)
    expect(g.polyhedral[0].polygons.length).toEqual(6)
  
  it 'polygon normals should point outwards', ->
    polygons_touched = 0
    for polygon in g.polyhedral[0].polygons
      for [coord, pos] in [['x', 0], ['x', 2], ['y', 0], ['y', 2], ['z', 0], ['z', 2]]
        if polygon.vertices.all((a) -> a[coord] == pos)
          
          ref = for coord1 in ['x','y','z']
            if coord1 == coord
              if pos == 2 then 1 else -1
            else
              0
          ref.push pos
          
          expect(polygon.plane).toBeSameArrayAs ref
          expect(polygon.touched).toBeUndefined()
          
          polygon.touched = true
          polygons_touched += 1
    
    expect(polygons_touched).toEqual(6)