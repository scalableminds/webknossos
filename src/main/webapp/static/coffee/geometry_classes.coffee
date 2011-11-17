class Polyhedron
  constructor: (@faces, @edges, @vertices) ->
  
    face.polyhedron = @ for face in @faces
    
    for edge in @edges
      edge.calc_interior()
      edge.polyhedron = @
  
    # calc extent
    @extent = Geometry.calcExtent(@vertices)
    
    
    for vertex in @vertices
      vertex.calc_interior()
      vertex.polyhedron = @
      
    
    
    @links = []

class Face2
  constructor: (@vertices) ->
    
  toFace3: ->
    

class Face3
  constructor: (@vertices, @edges, @plane) ->
    
    @extent = Geometry.calcExtent(@vertices)
      
    # calc plane equation
    unless @plane?
      [v1, v2, v3] = @vertices
      
      vec1 = v2.sub(v1)
      vec2 = v2.sub(v3)
      
      plane = Math.normalizeVector(Math.crossProduct(vec1, vec2))
      
      plane.push(plane[0] * v1.x + plane[1] * v1.y + plane[2] * v1.z)
      @plane = plane
    
    edge.adjoining_faces.push(@) for edge in @edges
  
  toFace2: ->
    vertices = new Vertex2Set()
    for v in @vertices
      vertices.add v.toVertex2 @plane
    
    for e in @edges
      v1 = vertices.get e.v1
      v2 = vertices.get e.v2
      v1.adj1 = v2
      v2.adj0 = v1
      v1.adjacents = [v2]
      v2.adjacents = [v3]
    
    face = new Face2 vertices.all()
  
  triangulate: ->
    
    for tri in Geometry.triangulate @toFace2.vertices
      for v in tri
        v.toFace3()

class Edge3
  constructor: (vertex1, vertex2) ->
    
    @vertices = [vertex1, vertex2]
    @adjoining_faces = []
    
    vertex1.edges.push @
    vertex2.edges.push @
    
    vertex1.adjacents.push vertex2
    
    @interior = true
    
    @links = []
  
  calc_interior: ->
    @interior = Utils.arrayEquals(@adjoining_faces[0].plane, @adjoining_faces[1].plane)
    
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
   
    v
  
  sub: (v2) ->
    [@x - v2.x, @y - v2.y, @z - v2.z]
    
  toArray: ->
    [@x, @y, @z]
  
  toString: ->
    @toArray().toString()
  
  equals: (a) ->
    @x == a.x and @y == a.y and @z == a.z

class GeometrySet
  constructor: ->
    @container = {}
  lookup: ->
  add: (e) ->
    @container[@lookup(e)] = e
  remove: (e) ->
    delete @container[@lookup(e)]
  get: (e) ->
    @container[@lookup(e)]
  all: ->
    for key in Object.keys @container
      @container[key]
  @fromArray: (arr) ->
    set = new @
    set.add el for el in arr
    set
      
class Edge2Set extends GeometrySet
  lookup: (e) -> "#{e[0].dx}x#{e[0].dy}|#{e[1].dx}x#{e[1].dy}"

class Edge3Set extends GeometrySet
  lookup: (e) -> "#{e[0].x}x#{e[0].y}x#{e[0].z}|#{e[1].x}x#{e[1].y}x#{e[1].z}"

class Vertex2Set extends GeometrySet
  lookup: (v) -> "#{v.dx}x#{v.dy}"

class Vertex3Set extends GeometrySet
  lookup: (v) -> "#{v.x}x#{v.y}x#{v.z}" 