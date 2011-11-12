describe 'geometry', ->
  g = null
  beforeEach ->
    g = new Geometry()
    ###
    g.load([
      [[2,0,0],[2,2,0],[0,2,0],[0,0,0]],
      [[0,0,0],[0,0,2],[2,0,2],[2,0,0]],
      [[0,2,0],[0,2,2],[0,0,2],[0,0,0]],
      [[0,0,2],[0,2,2],[2,2,2],[2,0,2]],
      [[2,2,0],[2,2,2],[0,2,2],[0,2,0]],
      [[2,0,0],[2,0,2],[2,2,2],[2,2,0]]
    ])
    g.load([
      [[3,1,1],[3,3,1],[1,3,1],[1,1,1]],
      [[1,1,1],[1,1,3],[3,1,3],[3,1,1]],
      [[1,3,1],[1,3,3],[1,1,3],[1,1,1]],
      [[1,1,3],[1,3,3],[3,3,3],[3,1,3]],
      [[3,3,1],[3,3,3],[1,3,3],[1,3,1]],
      [[3,1,1],[3,1,3],[3,3,3],[3,3,1]]
    ])
    ###
    
   
  it 'should load a polyhedron and triangulate', ->
    expect(g.polyhedral.length).toEqual(2)
    
    for p, i in g.polyhedral
      expect(p.vertices.length).toEqual(8)
      expect(p.faces.length).toEqual(12)
      expect(p.edges.length).toEqual(18)
      
      expect(p.extent.min).toBeSameArrayAs [0 + i, 0 + i, 0 + i]
      expect(p.extent.max).toBeSameArrayAs [2 + i, 2 + i, 2 + i]
    
  
  it 'polygon normals should point outwards', ->
    polygons_touched = 0
    for polygon in g.polyhedral[0].faces
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
    
    expect(polygons_touched).toEqual(12)
  
  it 'should return an intersection line segment', ->
    expect(g.find_intersections(g.polyhedral[0].faces[10], g.polyhedral[1].faces[1]))
      .toBeDefined()
    expect(g.find_intersections(g.polyhedral[0].faces[6], g.polyhedral[1].faces[5]))
      .toBeDefined()
  
  
  it 'should triangulate a monotone polygon', ->
    class V
      constructor: (@x, @y, @z) ->
      
      sub: (v2) ->
        [@x - v2.x, @y - v2.y, @z - v2.z]
      toString: ->
        [@x, @y, @z].toString()
    
    polygon = [
      new V 0,0,0
      new V 0,7,0
      new V 3,8,0
      new V 6,3,0
      new V 7,6,0
      new V 9,3,0
      new V 7,0,0
    ]
    for i in [0...polygon.length]
      polygon[i].adjacent1 = polygon[if i > 0 then i - 1 else polygon.length - 1]
      polygon[i].adjacent2 = polygon[(i + 1) % polygon.length]
    
    polygon = g.triangulate(polygon)
    console.log v[0].toString(), v[1].toString(), v[2] for v in polygon
    
    expect(polygon.length).toEqual(4)
    
    
    