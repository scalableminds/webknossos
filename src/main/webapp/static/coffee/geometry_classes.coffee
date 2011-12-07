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
  
  _mergeFaces: ->
    for e in @edges.all()
      e.merge() if Utils.arrayEquals(e.adjoining_faces[0].plane, e.adjoining_faces[1].plane)
  
  triangulate: ->
    for face in @faces.slice(0)
      face.triangulate()
    for edge in @edges.all()
      edge.calc_interior()
    
  
  
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
    _normal = @plane.map Math.abs 
      
    drop_index = if _normal[2] >= _normal[0] and _normal[2] >= _normal[1]
        2
      else if _normal[1] >= _normal[0] and _normal[1] >= _normal[2]
        1
      else
        0
    
    vertices2 = []
    for v in @vertices
      vertices2.push v.toVertex2(drop_index)
      
    lowerRightIndex = null
    for i in [0...vertices2.length]
      if lowerRightIndex == null or vertices2[i].compare(vertices2[lowerRightIndex]) < 0
        lowerRightIndex = i
    
    reversed = Geometry::ccw(
      vertices2[if lowerRightIndex - 1 < 0 then vertices2.length - 1 else lowerRightIndex - 1], 
      vertices2[lowerRightIndex], 
      vertices2[(lowerRightIndex + 1) % vertices2.length]
    ) < 0
    vertices2.reverse() if reversed
    
    edges2 = []
    for i in [0...vertices2.length]
      v0 = vertices2[i]
      v1 = vertices2[(i + 1) % vertices2.length]
      throw "Vertex lining isn't correct" unless (v0.original.adjacents.has(v1.original) and v1.original.adjacents.has(v0.original))
      edges2.push new Edge2(v0, v1)
      v0.adj[1] = v1
      v1.adj[0] = v0
    
    face = new Face2 vertices2, edges2
    face.original = @
    face.reversed = reversed
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
      vertices.reverse() if face2.reversed
      
      edges = []
      for edge2 in face2.edges
        edge3 = new Edge3(edge2[0].original, edge2[1].original)
        edge3 = @edges.get(edge3) || edge3
        if @polyhedron?
          edge3.polyhedron = @polyhedron
          edge3 = @polyhedron.edges.add edge3
        edges.push edge3
        
      plane = if face2.original? then face2.original.plane else null 
      
      face3 = new Face3(vertices, edges, plane)
      if @polyhedron?
        face3.polyhedron = @polyhedron
        @polyhedron.faces.push face3
      
      face3
    

class Face2
  constructor: (@vertices, @edges) ->
    e.face = @ for e in @edges
    v.face = @ for v in @vertices
    
  splitAtVertices: (splitting_vertices...) ->  
    
    return false if splitting_vertices.length < 2
    
    first = splitting_vertices[0]
    last = splitting_vertices[splitting_vertices.length - 1]
    
    vertices = @vertices.map((a) -> a.clone())
    
    # find split indexes
    for v, i in @vertices
      first_index = i if v.compare(first) == 0
      last_index = i if v.compare(last) == 0
      break if first_index? and last_index?
    
    # split vertices-buffers
    if first_index < last_index
      vertices0 = vertices.slice(first_index, last_index + 1)
      vertices1 = vertices.slice(last_index).concat vertices.slice(0, first_index + 1)
    else
      vertices0 = vertices.slice(first_index).concat vertices.slice(0, last_index + 1)
      vertices1 = vertices.slice(last_index, first_index + 1)
      
    # face0
    vertices0 = splitting_vertices.slice(1, -1).reverse().map((a) -> a.clone()).concat(vertices0)
    edges0 = []
    for v, i in vertices0
      v0 = vertices0[i]
      v1 = vertices0[(i+1) % vertices0.length]
      
      v0.adj[1] = v1
      v1.adj[0] = v0
      edges0.push new Edge2(vertices0[i], vertices0[(i + 1) % vertices0.length])
    
    face0 = new Face2(vertices0, edges0)
    face0.original = @original

    
    # face1
    vertices1[0] = vertices1[0].clone()
    vertices1[vertices1.length - 1] = vertices1[vertices1.length - 1].clone()
    
    vertices1 = splitting_vertices.slice(1, -1).map((a) -> a.clone()).concat(vertices1)
    edges1 = []
    for v, i in vertices1
      v0 = vertices1[i]
      v1 = vertices1[(i+1) % vertices1.length]
      
      v0.adj[1] = v1
      v1.adj[0] = v0
      edges1.push new Edge2(vertices1[i], vertices1[(i + 1) % vertices1.length])
      
    for i in [0...vertices1.length]
      v0 = vertices1[i]
      v1 = vertices1[(i+1) % vertices1.length]
      
    face1 = new Face2(vertices1, edges1)
    face1.original = @original
    
    [face0, face1]
  
  splitByMultipleVertices: (vertices_sets) ->
    
    return false if vertices_sets.length < 1
    
    make_container = (face) ->
      {face: face, verticeSet: Vertex2Set.fromArray(face.vertices)}
    
    faces = [make_container(@)]
    for vertices_set in vertices_sets
      for faceContainer, i in faces
        if faceContainer.verticeSet.has(vertices_set[0]) and 
        faceContainer.verticeSet.has(vertices_set[vertices_set.length - 1])
          newFaces = faceContainer.face.splitAtVertices(vertices_set...)
          faces.splice(i, 1, make_container(newFaces[0]), make_container(newFaces[1]))
          break
     
    face.face for face in faces
    
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
  
  toVertex2: (drop_index) ->
    
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
      
    