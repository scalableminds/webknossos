class Polyhedron
  constructor: (@faces, @vertices, @edges) ->
  
    face.polyhedron = @ for face in @faces
    
    for edge in @edges.all()
      edge.calc_interior()
      edge.polyhedron = @
  
    # calc extent
    @extent = Geometry.calcExtent(@vertices.all())
    
    
    for vertex in @vertices.all()
      vertex.calc_interior()
      vertex.polyhedron = @
  
  mergeFaces: ->
    for e in @edges.all()
      e.merge() if Utils.arrayEquals(e.adjoining_faces[0].plane, e.adjoining_faces[1].plane)
  
  
  union: (other) ->
  
  intersection: (other) ->
  
  difference: (other) ->
  
  splitPolyhedron: ->

class Face3
  constructor: (@vertices, edges, @plane) ->
    
    e.adjoining_faces.push @ for e in edges

    @edges = Edge3Set.fromArray edges 
    
    @extent = Geometry.calcExtent(@vertices)
    
    # calc plane equation
    unless @plane?
      [v1, v2, v3] = @vertices
      
      vec1 = v2.sub(v1)
      vec2 = v2.sub(v3)
      
      plane = Math.normalizeVector(Math.crossProduct(vec1, vec2))
      
      plane.push(plane[0] * v1.x + plane[1] * v1.y + plane[2] * v1.z)
      @plane = plane
    
    edge.adjoining_faces.push(@) for edge in edges
  
  toFace2: ->
    vertices2 = new Vertex3Vertex2Dictionary
    for v in @vertices
      vertices2.add v, v.toVertex2(@plane)
    
    edges2 = []
    for e in @edges.all()
      v0 = vertices2.get(e[0])
      v1 = vertices2.get(e[1])
      edge2 = new Edge2 v0, v1
      edge2.original = e
      v0.addEdge edge2
      v1.addEdge edge2
      edges2.push edge2
      
    face = new Face2 vertices2.all(), edges2
    face.original = @
    face
  
  triangulate: ->
    
    face2 = @toFace2()
    
    face2s = []
    for monotone in Geometry.monotonize face2
      for triangle in Geometry.triangulateMonotone monotone
        face2s.push triangle
    
    @fromFace2s(face2s)
  
  remove: ->
    for e in @edges.all()
      (adj = e.adjoining_faces).splice(adj.indexOf(@), 1)
    
    (faces = @polyhedron.faces).splice(faces.indexOf(@), 1) if @polyhedron?
  
  fromFace2s: (face2s) ->
    @remove()
    
    for face2 in face2s
      
      vertices = []
      for vertex2 in face2.vertices
        vertices.push vertex2.original
      
      edges = []
      for edge2 in face2.edges
        edge3 = new Edge3(edge2[0].original, edge2[1].original)
        if @polyhedron?
          edge3.polyhedron = @polyhedron
          edge3 = @polyhedron.edges.add edge3
        edges.push edge3
        
      face3 = new Face3(vertices, edges)
      if @polyhedron?
        face3.polyhedron = @polyhedron
        @polyhedron.faces.push face3
      
      face3
    

class Face2
  constructor: (@vertices, @edges) ->
    e.face = @ for e in @edges
    v.face = @ for v in @vertices
    
  
  splitAtEdges: (edges...) ->
    
    return false if edges.length < 1
    
    buildFace = (vertices0) ->
      
      first = vertices0[0]
      last  = vertices0[vertices0.length - 1]
      v = last.adj[0]
      while v != first
        vertices0.push v
        _last = v
        v = if last == v.adj[0] then v.adj[1] else v.adj[0]
        last = _last
      
      edges0 = []
      for i in [0...vertices0.length]
        v0 = vertices0[i]
        v1 = vertices0[(i+1) % vertices0.length]
        edges0.push new Edge2(v0, v1)
        v0.adj[0] = v1
        v1.adj[1] = v0
        
      new Face2(vertices0, edges0)
    
    # collect vertices
    # edges needs to be ordered
    # inner vertices (0 < i < -1) don't need to be connected via adj-pointers
    edge0 = edges[0]
    if edges.length > 1
      
      vertices = []
      edge1 = edges[1]
      if edge1[0] == edge0[0] or edge1[1] == edge0[0]
        vertices.push edge0[1], edge0[0]
      else
        vertices.push edge0[0], edge0[1]
      
      for i in [1...edges.length]
        vertices.push(edges[i].other(vertices[i]))
    else
      vertices = [edge0[0], edge0[1]]      
    
    # clone all the vertices which get split
    _vertices = (v.clone() for v in vertices)
    
    # set adj-pointers for face 0
    for i in [0...vertices.length]
      vertices[i].adj[0] = vertices[i + 1] unless i == vertices.length - 1
      vertices[i].adj[1] = vertices[i - 1] unless i == 0
    
    
    # set adj-pointers for face 1
    for i in [0..._vertices.length]
      _vertices[i].adj[1] = _vertices[i + 1] unless i == _vertices.length - 1
      _vertices[i].adj[0] = _vertices[i - 1] unless i == 0
    
    _first = _vertices[0]
    _last  = _vertices[_vertices.length - 1]
    
    _first.adj[0].adj[1] = _first
    _last.adj[1].adj[0] = _last
    
    [buildFace(vertices), buildFace(_vertices.reverse())]
    
    
class Edge2
  constructor: (vertex1, vertex2) ->
    
    if (vertex2.compare vertex1) < 0
      [vertex1, vertex2] = [vertex2, vertex1]
    
    @[0] = vertex1
    @[1] = vertex2
    
    @vector = vertex2.sub vertex1
    @sin = Math.normalize(@vector[1])
    @cos = @vector[0] / Math.vecLength(@vector)
  
  length: 2
  
  compare: (other) ->
    @sin - other.sin || @sin * (@cos - other.cos)
  
  other: (v) ->
    if v == @[0] then @[1] else @[0]
  
  linear: (y) ->
    if Math.between(y, @[0].dy, @[1].dy)
      (-(@[0].dx * (@[1].dy - y) - @[1].dx * (@[0].dy - y)) / (@[0].dy - @[1].dy))
    else
      false
  
  splitByVertex: (v) ->
    if Math.nearlyEquals(@linear(v.dy), v.dx)
      if @[0].adj[0] == @[1]
        @[0].adj[0] = v
        v.adj[0] = @[1]
        v.adj[1] = @[0]
        @[1].adj[1] = v
      else
        @[0].adj[1] = v
        v.adj[1] = @[1]
        v.adj[0] = @[0]
        @[1].adj[0] = v
      [new Edge2(@[0], v), new Edge2(@[1], v)]
    else
      [@]
    
class Edge3
  constructor: (vertex1, vertex2) ->
    
    if (vertex2.compare vertex1) < 0
      [vertex1, vertex2] = [vertex2, vertex1]
    
    @[0] = vertex1
    @[1] = vertex2
    
    @adjoining_faces = []
    
    vertex1.adjacents.add vertex2
    vertex2.adjacents.add vertex1
    
    @interior = true
  
  length: 2
  
  calc_interior: ->
    @interior = Utils.arrayEquals(@adjoining_faces[0].plane, @adjoining_faces[1].plane)
    
  other: (v) ->
    if v == @[0] then @[0] else @[1]
  
  vector: ->
    @[1].sub(@[0])
    
  remove: ->
    @[0].adjacents.remove @[1]
    @[1].adjacents.remove @[0]
    
    @adjoining_faces[0].edges.remove @
    @adjoining_faces[1].edges.remove @
    
    @polyhedron?.edges.remove @
  
  mergeFaces: ->
    [face0, face1] = @adjoining_faces
    e.remove()
    face0.vertices = face0.vertices.concat(face1.vertices)
    face0.edges.bulkAdd(face1.edges.all())
    face0
  
  splitByVertex: (v) ->
    @remove()
    edges = [new Edge3(@[0], v), new Edge3(@[1], v)]
    for e in edges
      e.adjoining_faces = @adjoining_faces.slice(0)
      e.interior = @interior
      face.edges.add e for face in @adjoining_faces
      @polyhedron?.edges.add e
    edges
    
class Vertex2
  constructor: (@dx, @dy) ->
    @adj = []
    
  toVertex3: ->
    v = @original
    v.adjacents.add v.adj0.original
    v.adjacents.add v.adj1.original
  
  addEdge: (e) ->
    unless @adj[0]
      @adj[0] = e.other @
    else unless @adj[1]
      @adj[1] = e.other @
  
  clone: ->
    v = new Vertex2 @dx, @dy
    v.adj = @adj.slice 0
    v.original = @original
    v.normal = @normal
    v.face = @face if @face
    v
  
  compare: (other) ->
    @dy - other.dy or other.dx - @dx
  
  sub: (v2) ->
    [@dx - v2.dx, @dy - v2.dy]
  
  toArray: ->
    [@dx, @dy]
  
  
class Vertex3
  constructor: (@x, @y, @z) ->

    @edges = []
    
    # null = unknown, -1 = outside, 0 = boundary, 1 = inside
    @status = null
    
    @adjacents = new Vertex3Set
    
    @interior = true
  
  @fromArray: (arr) ->
    new Vertex3 arr[0], arr[1], arr[2]
  
  calc_interior: ->
    for edge in @edges
      return edge.interior = false unless edge.interior
  
  toVertex2: (normal) ->
    _normal = normal.map Math.abs 
      
    drop_index = if _normal[2] >= _normal[0] and _normal[2] >= _normal[1]
        2
      else if _normal[1] >= _normal[0] and _normal[1] >= _normal[2]
        1
      else
        0
    
    switch drop_index
      when 0
        dx = @y
        dy = @z
      when 1
        dx = @x
        dy = @z
      else
        dx = @x
        dy = @y
    
    v = new Vertex2 dx, dy
    v.original = @
    v.normal = normal
    
    @vertex2 = v
    
    v
  
  sub: (v2) ->
    if @dx?
      [@dx - v2.dx, @dy - v2.dy]
    else
      [@x - v2.x, @y - v2.y, @z - v2.z]
    
  toArray: ->
    [@x, @y, @z]
  
  toString: ->
    @toArray().toString()
  
  equals: (a) ->
    @x == a.x and @y == a.y and @z == a.z
    
  compare: (other) ->
    if @dx?
      @dy - other.dy or other.dx - @dx
    else
      @x - other.x or @y - other.y or @z - other.z
    
  remove: ->
    e.remove() for e in @edges

class GeometrySet
  constructor: ->
    @container = {}
    @length = 0
  lookup: ->
  add: (e) ->
    if (tmp = @container[l = @lookup(e)])?
      tmp
    else
      @container[l] = e
      @length += 1
      e
      
  remove: (e) ->
    if (tmp = @container[l = @lookup(e)])?
      delete @container[l]
      @length -= 1
      true
    else
      false
      
  replace: (e, a...) ->
    if @remove e
      @add _a for _a in a
  get: (e) ->
    @container[@lookup(e)]
  has: (e) ->
    @container[@lookup(e)]?
  all: ->
    for key in Object.keys @container
      @container[key]
  bulkAdd: (arr) ->
    @add el for el in arr
    return
  @fromArray: (arr) ->
    set = new @
    set.bulkAdd arr
    set
      
class Edge2Set extends GeometrySet
  lookup: (e) -> "#{e[0].dx}x#{e[0].dy}|#{e[1].dx}x#{e[1].dy}"

class Edge3Set extends GeometrySet
  lookup: (e) -> "#{e[0].x}x#{e[0].y}x#{e[0].z}|#{e[1].x}x#{e[1].y}x#{e[1].z}"

class Vertex2Set extends GeometrySet
  lookup: (v) -> "#{v.dx}x#{v.dy}"

class Vertex3Set extends GeometrySet
  lookup: (v) -> "#{v.x}x#{v.y}x#{v.z}" 

class Vertex3Vertex2Dictionary extends GeometrySet
  lookup: (v) -> "#{v.x}x#{v.y}x#{v.z}"
  
  add: (v3, v2) ->
    if (tmp = @container[l = @lookup(v3)])?
      tmp
    else
      @container[l] = v2
      @length += 1
      v2
  
class Vertex2Edge3Dictionary extends GeometrySet
  lookup: (v) -> "#{v.dx}x#{v.dy}"
  
  add: (v, e) ->
    unless (tmp = @container[l = @lookup(v)])?
      tmp = @container[l] = new Edge3Set
      @length += 1
    tmp.add e
    
  remove: (e) ->
    ret = false
    if (tmp = @container[l = @lookup(e[0].vertex2)])? and (tmp.remove e) and tmp.length == 0
      delete @container[l]
      @length -= 1
      ret = true
    if (tmp = @container[l = @lookup(e[1].vertex2)])? and (tmp.remove e) and tmp.length == 0
      delete @container[l]
      @length -= 1
      ret = true
    ret
      
    