describe 'geometry', ->
  describe 'with pre-loading', ->
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
      g.load([
        [[3,1,1],[3,3,1],[1,3,1],[1,1,1]],
        [[1,1,1],[1,1,3],[3,1,3],[3,1,1]],
        [[1,3,1],[1,3,3],[1,1,3],[1,1,1]],
        [[1,1,3],[1,3,3],[3,3,3],[3,1,3]],
        [[3,3,1],[3,3,3],[1,3,3],[1,3,1]],
        [[3,1,1],[3,1,3],[3,3,3],[3,3,1]]
      ])
      
     
    it 'should load a polyhedron', ->
      expect(g.polyhedral.length).toEqual(2)
      
      for p, i in g.polyhedral
        expect(p.vertices.all().length).toEqual(8)
        expect(p.faces.length).toEqual(6)
        expect(p.edges.all().length).toEqual(12)
        
        expect(p.extent.min).toBeSameArrayAs [0 + i, 0 + i, 0 + i]
        expect(p.extent.max).toBeSameArrayAs [2 + i, 2 + i, 2 + i]
      
    
    it 'polygon normals should point outwards', ->
      polygons_touched = 0
      for polygon in g.polyhedral[0].faces
        for [coord, pos] in [['x', 0], ['x', 2], ['y', 0], ['y', 2], ['z', 0], ['z', 2]]
          if Utils.arrayAll(polygon.vertices, (a) -> a[coord] == pos)
            
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
    
    it 'should return an intersection line segment', ->
      expect(g.findFaceIntersections(g.polyhedral[0].faces[4], g.polyhedral[1].faces[0]))
        .toBeDefined()
      expect(g.findFaceIntersections(g.polyhedral[0].faces[4], g.polyhedral[1].faces[4]))
        .toBeDefined()
  
  
  face2ize = (vertices) ->
    
    vertices = for a in vertices
      new Vertex3(a[0], a[1], a[2])
    
    edges = for i in [0...vertices.length]
      new Edge3 vertices[i], vertices[(i + 1) % vertices.length]
    
    new Face3(vertices, edges).toFace2()
  
  
  polygonize = (vertices) ->
    
    polygon = vertices.map (a) -> new Vertex3(a...)
    
    for i in [0...polygon.length]
      polygon[i].adjacents.add polygon[if i > 0 then i - 1 else polygon.length - 1]
      polygon[i].adjacents.add polygon[(i + 1) % polygon.length]
    polygon
  
  it 'should split a polygon by adding a diagonal', ->
    
    # setup
    face = face2ize [
      [0,0,0],
      [0,10,0],
      [4,10,0],
      [2,9,0],
      [2,7,0],
      [7,8,0],
      [4,6,0],
      [5,3,0],
      [3,4,0],
      [1,1,0],
      [4,1,0],
      [6,2,0],
      [5,0,0]
    ]
    
    # do the work
    # split at (2,7),(1,1)
    faces = face.splitAtEdge(face.vertices[4], face.vertices[9])
    
    # split at (3,4),(4,6)
    faces1 = faces[0].splitAtEdge(face.vertices[8], face.vertices[6])
    
    # split at (0,0),(2,9)
    faces2 = faces[1].splitAtEdge(face.vertices[0], face.vertices[3])
    
    faces = faces1.concat faces2
    
    # simple counting tests
    expect(faces[0].vertices.length).toEqual(5)
    expect(faces[1].vertices.length).toEqual(3)
    expect(faces[2].vertices.length).toEqual(4)
    expect(faces[3].vertices.length).toEqual(7)
    
    # test if adjacent links work
    test_round = (vertices, direction) ->
      i = 0
      v = vertices[0].adj[direction]
      while v != vertices[0]
        return false if vertices.indexOf(v) == -1
        v = v.adj[direction]
        return false if i++ == vertices.length - 1
      true
          
    for i in [0...faces.length]
      expect(test_round(faces[i].vertices, 0)).toBeTruthy()
      expect(test_round(faces[i].vertices, 1)).toBeTruthy()
  
  it 'should triangulate a monotone polygon', ->
    
    # setup
    face = face2ize [
      [0,0,0]
      [0,7,0]
      [3,8,0]
      [6,3,0]
      [7,6,0]
      [9,3,0]
      [7,0,0]
    ]
    
    # do the work
    faces = Geometry.triangulateMonotone(face)
    
    # simple test to start
    expect(faces.length).toEqual(5)
    
    for tri in faces
      expect(tri.vertices.length).toEqual(3)
      expect(tri.edges.length).toEqual(3)
    
    
    # find all edges
    edges = []
    for tri in faces
      edges = edges.concat tri.edges
    
    # check whether any edge intersect another
    # O(n²) but I don't care
    for e1, i1 in edges
      p1 = e1[0]
      vec1 = e1[1].sub(p1)
      
      for e2, i2 in edges
        unless i1 == i2
          p2 = e2[0]
          vec2 = e2[1].sub(p2)
          
          # quick check whether the extents overlap
          if Geometry.overlaps2d(Geometry.calcExtent(e1), Geometry.calcExtent(e2))
            if (e1[0].equals(e2[0]) and e1[1].equals(e2[1])) or (e1[0].equals(e2[1]) and e1[1].equals(e2[0]))
              e1.colinear += 1
            else
              # thanks Gareth Rees
              # http://stackoverflow.com/questions/563198#565282
              qp = [p2.x - p1.x, p2.y - p1.y, p2.z - p1.z]
              qp1 = Math.crossProduct(qp, vec1)
              qp2 = Math.crossProduct(qp, vec2)
              rs = Math.crossProduct(vec1, vec2)
              
              t1 = Math.vecLength(qp1) / Math.vecLength(rs)
              t2 = Math.vecLength(qp2) / Math.vecLength(rs)
              
              # since Math.vecLength always return a positive number
              # we need to check both possible intersection points
              p11 = [p1.x + (-t1) * vec1[0], p1.y + (-t1) * vec1[1], p1.z + (-t1) * vec1[2]]
              p12 = [p1.x + t1 * vec1[0],    p1.y + t1 * vec1[1],    p1.z + t1 * vec1[2]]
              p21 = [p2.x + (-t2) * vec2[0], p2.y + (-t2) * vec2[1], p2.z + (-t2) * vec1[2]]
              p22 = [p2.x + t2 * vec2[0],    p2.y + t2 * vec2[1],    p2.z + t2 * vec1[2]]
              
              if Utils.arrayEquals(p11, p21)
                t1 = -t1
                t2 = -t2
              else if Utils.arrayEquals(p12, p21)
                t2 = -t2
              else if Utils.arrayEquals(p11, p22)
                t1 = -t1
              else unless Utils.arrayEquals(p12, p22)
                # oops, no intersection found
                continue
              
              # for intersection points 0 < t1, t2 < 1 would be valid
              # but we don't want any
              expect(t1).not.toBeStrictlyBetween(0, 1)
              expect(t2).not.toBeStrictlyBetween(0, 1)
    
    # each edge should only have one partner egde with same vertices
    for e in edges
      expect(e.colinear).toBeLessThan(2) if e.colinear
    
  
  it 'should split a polygon in monotones', ->
    # setup
    # plane: normal = [0, 0, 1], d = 0
    polygon = face2ize [
      [0,0,0],
      [0,10,0],
      [4,10,0],
      [2,9,0],
      [2,7,0],
      [7,8,0],
      [4,6,0],
      [5,3,0],
      [3,4,0],
      [1,1,0],
      [4,1,0],
      [6,2,0],
      [5,0,0]
    ]
    
    # do the work
    monotones = Geometry.monotonize(polygon)
    
    # simple test to start
    expect(monotones.length).toEqual(4)
    
    # make sure the monotone propery is ensured for each polygon
    for face in monotones
      expect(face).toBeA Face2
      face.vertices.sort (a, b) -> a.compare b
      
      first = face.vertices[0]
      last = face.vertices[face.vertices.length - 1]
      
      unless face.vertices.length == 3
        i = 0
        v = first.adj[0]
        while v.adj[0] != last
          expect(v.compare v.adj[0]).toBeLessThan 0
          v = v.adj[0]
          if i++ == 1000
            expect(i).toBeLessThan 1000
            break
        
        i = 0
        v = first.adj[1]
        while v.adj[1] != last
          expect(v.compare v.adj[1]).toBeGreaterThan 0
          v = v.adj[1]
          if i++ == 1000
            expect(i).toBeLessThan 1000
            break
    return

  it 'should translate any face3 to face2', ->
    
    # setup
    # normal = [-3, 0, 1]
    vertices = [
      new Vertex3 3,4,5
      new Vertex3 4,6,8
      new Vertex3 3,5,5
    ]
    edges = [
      new Edge3 vertices[0], vertices[1]
      new Edge3 vertices[1], vertices[2]
      new Edge3 vertices[2], vertices[0]
    ]
    
    face = new Face3 vertices, edges
    
    # do the work
    face2 = face.toFace2()
    
    # the x-coordinate should be gone
    for v, i in face2.vertices
      expect(v).toBeA Vertex2
      expect(vertices.indexOf(v.original)).not.toEqual -1 
      expect(vertices[i].y).toEqual(v.dx)
      expect(vertices[i].z).toEqual(v.dy)
      
    for e in face2.edges
      expect(e).toBeA Edge2
      expect(edges.indexOf(e.original)).not.toEqual -1 
      
    