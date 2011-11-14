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
    
   
  # it 'should load a polyhedron and triangulate', ->
    # expect(g.polyhedral.length).toEqual(2)
    
    # for p, i in g.polyhedral
      # expect(p.vertices.length).toEqual(8)
      # expect(p.faces.length).toEqual(12)
      # expect(p.edges.length).toEqual(18)
      
      # expect(p.extent.min).toBeSameArrayAs [0 + i, 0 + i, 0 + i]
      # expect(p.extent.max).toBeSameArrayAs [2 + i, 2 + i, 2 + i]
    
  
  # it 'polygon normals should point outwards', ->
    # polygons_touched = 0
    # for polygon in g.polyhedral[0].faces
      # for [coord, pos] in [['x', 0], ['x', 2], ['y', 0], ['y', 2], ['z', 0], ['z', 2]]
        # if Utils.arrayAll(polygon.vertices.all, (a) -> a[coord] == pos)
          
          # ref = for coord1 in ['x','y','z']
            # if coord1 == coord
              # if pos == 2 then 1 else -1
            # else
              # 0
          # ref.push pos
          
          # expect(polygon.plane).toBeSameArrayAs ref
          # expect(polygon.touched).toBeUndefined()
          
          # polygon.touched = true
          # polygons_touched += 1
    
    # expect(polygons_touched).toEqual(12)
  
  it 'should return an intersection line segment', ->
    # expect(g.find_intersections(g.polyhedral[0].faces[10], g.polyhedral[1].faces[1]))
      # .toBeDefined()
    # expect(g.find_intersections(g.polyhedral[0].faces[6], g.polyhedral[1].faces[5]))
      # .toBeDefined()
  
  class V
    constructor: (@x, @y, @z) ->
      
    sub: (v2) ->
      [@x - v2.x, @y - v2.y, @z - v2.z]
    toString: ->
      @toArray().toString()
    toArray: ->
      [@x, @y, @z]
    clone: ->
      new V @x, @y, @z
    eq: (other) ->
      @x == other.x and @y == other.y and @z == other.z
  
  polygonize = (vertices) ->
    
    polygon = vertices.map (a) -> new V(a...)
    
    for i in [0...polygon.length]
      polygon[i].adjacent0 = polygon[if i > 0 then i - 1 else polygon.length - 1]
      polygon[i].adjacent1 = polygon[(i + 1) % polygon.length]
    
    polygon
  
  it 'should triangulate a monotone polygon', ->
    
    # setup
    polygon = polygonize [
      [0,0,0]
      [0,7,0]
      [3,8,0]
      [6,3,0]
      [7,6,0]
      [9,3,0]
      [7,0,0]
    ]
    
    # do the work
    polygon = g.triangulate(polygon)
    
    # simple test to start
    expect(polygon.length).toEqual(5)
    
    # find all edges
    edges = []
    for tri in polygon
      edges.push [tri[0],tri[1]], [tri[1],tri[2]], [tri[2],tri[0]]
    
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
          if g.overlaps2d(g.calc_extent(e1), g.calc_extent(e2))
            if (e1[0].eq(e2[0]) and e1[1].eq(e2[1])) or (e1[0].eq(e2[1]) and e1[1].eq(e2[0]))
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
    polygon = _polygon = polygonize [
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
    monotones = g.monotonize(polygon)
    
    console.log 'it should split a polygon in monotones'
    
    
    expect(monotones.length).toEqual(4)
    
    # TODO: test for monotonicity
    monotones = [_polygon]
    
    for polygon in monotones
      polygon = g.translateToXY(polygon)
      sweep_status = []
      
      polygon.sort((a, b) -> a.dy - b.dy || b.dx - a.dx)
      edges = {}
      
      comp = (a, b) -> a.dy - b.dy || b.dx - a.dx
      for v in polygon
        if comp(v, v.adjacent0) < 0
          edges["#{v.dy}x#{v.dx}-#{v.adjacent0.dy}x#{v.adjacent0.dx}"] ?= [v, v.adjacent0]
        else
          edges["#{v.adjacent0.dy}x#{v.adjacent0.dx}-#{v.dy}x#{v.dx}"] ?= [v.adjacent0, v]
      
        if comp(v, v.adjacent1) < 0
          edges["#{v.dy}x#{v.dx}-#{v.adjacent1.dy}x#{v.adjacent1.dx}"] ?= [v, v.adjacent1]
        else
          edges["#{v.adjacent1.dy}x#{v.adjacent1.dx}-#{v.dy}x#{v.dx}"] ?= [v.adjacent1, v]
      
      for v in polygon
        edges_in_y = []
        for key, e of edges
          if Math.min(e[0].dy, e[1].dy) <= v.y <= Math.max(e[0].dy, e[1].dy) and e[0].dy != e[1].dy and v != e[0] and v != e[1]
            edges_in_y.push e
        
        console.log edges_in_y, v
        expect(edges_in_y.length).toBeLessThan(2)

  
  it 'should project any plane into xy-plane', ->
    
    # setup
    # normal = [-3, 0, 1]
    vertices = [
      new V 3,4,5
      new V 4,6,8
      new V 3,5,5
    ]
    
    # do the work
    vertices = g.translateToXY(vertices)
    
    # the x-coordinate should be gone
    for v in vertices
      expect(v.y).toEqual(v.dx)
      expect(v.z).toEqual(v.dy)
    
    