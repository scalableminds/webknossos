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
  
  triangulate: ->
    
    v.to2d(@plane) for v in @vertices
    
    [vertices, edges] = Geometry.monotonize @vertices, @edges
    
    faces = Geometry.triangulateMonotonize vertices, edges
    
    v.clean2d() for v in vertices
    
    faces
    
class Edge2
  constructor: (vertex1, vertex2) ->
    
    if (vertex2.compare vertex1) < 0
      [vertex1, vertex2] = [vertex2, vertex1]
    
    @[0] = vertex1
    @[1] = vertex2
    
  other: (v) ->
    if v == @[0] then @[0] else @[1]
    
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
    
    @links = []
  
  length: 2
  
  calc_interior: ->
    @interior = Utils.arrayEquals(@adjoining_faces[0].plane, @adjoining_faces[1].plane)
    
  other: (v) ->
    if v == @[0] then @[0] else @[1]
  
  vector: ->
    @[1].sub(@[0])
    
  compare: (other) ->
    vec0 = @vector()
    vec1 = other.vector()
    
    (sin = Math.normalize(vec0[1])) - Math.normalize(vec1[1]) || (if sin > 0 then vec0[0] - vec1[0] else vec1[0] - vec0[0])
    
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
    
class Vertex2
  constructor: (@dx, @dy) ->
    
  toVertex3: ->
    v = @original
    v.adjacents.add v.adj0.original
    v.adjacents.add v.adj1.original
  
  clone: ->
    v = new Vertex2 @dx, @dy
    v.adj0 = @adj0
    v.adj1 = @adj1
    v.original = @original
    v.normal = @normal
    v._adjacents = @_adjacents if @_adjacents
    v.polygon = @polygon if @polygon
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
  
  to2d: (normal) ->
    _normal = normal.map Math.abs 
      
    drop_index = if _normal[2] >= _normal[0] and _normal[2] >= _normal[1]
        2
      else if _normal[1] >= _normal[0] and _normal[1] >= _normal[2]
        1
      else
        0
    
    switch drop_index
      when 0
        @dx = @y
        @dy = @z
      when 1
        @dx = @x
        @dy = @z
      else
        @dx = @x
        @dy = @y
 
    @dnormal = normal
  
  clean2d: ->
    delete @dx
    delete @dy
    delete @dnormal
  
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
      
    