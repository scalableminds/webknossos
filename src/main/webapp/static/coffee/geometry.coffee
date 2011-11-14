class Geometry
  constructor: ->
    @polyhedral = []
  
  load: (data) ->
    
    vertices = {}
    edges = {}
    faces = []
    
    get_edge = (vertex1, vertex2) ->
      if Utils.arrayCompare(vertex1.toArray(), vertex2.toArray()) == 1
        [vertex1, vertex2] = [vertex2, vertex1]
      
      hit_edges = edges["#{vertex1}x#{vertex2}"] ?= []
      
      for edge in hit_edges
        return edge if edge.adjoining_faces.length < 2
      
      hit_edges.push tmp = new Edge(vertex1, vertex2)
      tmp
    
    for polygon in data
      for face in @triangulate(polygon)
        
        face_vertices = for _vertex in face
          vertices[_vertex.toString()] ?= new Vertex(_vertex)
        
        face_edges = for i in [0...face_vertices.length]
          
          vertex1 = face_vertices[i]
          vertex2 = face_vertices[(i + 1) % face_vertices.length]
          
          get_edge(vertex1, vertex2)
        
        faces.push tmp = new Face(face_vertices, face_edges)
        tmp
    
    @polyhedral.push new Polyhedron(
      faces,
      Object.keys(edges).map((a) -> edges[a]).reduce((r,a) -> r.concat a),
      Object.keys(vertices).map((a) -> vertices[a])
    )
  
  monotonize: (polygon) ->
    
    output = []
    
    polygon = @translateToXY(polygon) unless polygon[0].dx?
    polygon.sort((a, b) -> a.dy - b.dy || b.dx - a.dx)
    
    sweep_status = new AvlTree (a, b) -> 
      (a[1].dy - b[1].dy || b[1].dx - a[1].dx) || (a[0].dy - b[0].dy || b[0].dx - a[0].dx)
      
    nonregulars = []
    for v in polygon[1..-1]
      v0 = v.adjacent0
      v1 = v.adjacent1
      if (v0.dy < v.dy or (v0.dy == v.dy and v0.dx > v.dx)) and (v1.dy > v.dy or (v1.dy == v.dy and v1.dx < v.dx))
        nonregulars.push v
    
    cur_y = null
    events = []
    # do the sweep
    for v, i in polygon
      
      if cur_y != v.dy
        if cur_y?
          for ev in events
            console.log ev, sweep_status.getValues().slice()
          events = []
        cur_y = v.dy
        
      
      incoming = outgoing = 0
      
      # sweep stuff
      v0 = v.adjacent0
      if v0.dy < v.dy
        sweep_status.add [v, v0]
        outgoing += 1
      else if v0.dy > v.dy
        sweep_status.remove [v0, v]
        incoming += 1
      else # v0.dy == v.dy
        v0.skip = true
      
      v1 = v.adjacent1
      if v1.dy < v.dy
        sweep_status.add [v, v1]
        outgoing += 1
      else if v1.dy > v.dy
        sweep_status.remove [v1, v]
        incoming += 1
      else # v1.dy == v.dy
        v1.skip = true
        
      if outgoing == 0 and not v.skip
        events.push v
      
    
    output
  
  triangulate: (polygon) ->
    
    calc_reflex = (vertex, ref) ->
      vertex.reflex = not Math.vecAngleIsntReflex(
        vertex.adjacent0.sub(vertex),
        vertex.adjacent1.sub(vertex),
        ref
      )
    remove_links = (v_old) ->
      v0 = v_old.adjacent0
      v1 = v_old.adjacent1
      
      if v0.adjacent0 == v_old
        v0.adjacent0 = v1
      else
        v0.adjacent1 = v1
        
      if v1.adjacent0 == v_old
        v1.adjacent0 = v0
      else
        v1.adjacent1 = v0
    
    output = []
      
    # monotonize
    # monotones = @monotonize(polygon)
    monotones = [polygon]
    
    # triangulate each monotone polygon
    for p in monotones
    
      p = @translateToXY(p) unless p[0].dx?
      p.sort (a, b) -> b.y - a.y
      # plane normal of the polygon
      # requires angle (p[1],p[0],p[2]) < 180°
      # which should always be the case because of the desc-y-ordering
      ref_normal = Math.normalizeVector(Math.crossProduct(p[1].sub(p[0]), p[2].sub(p[0])))
      
      stack = []
      
      # assumes ccw ordering of vertices
      for v in p[2..-1]
        unless calc_reflex(v, ref_normal)
          stack.push v
          
      while stack.length > 0
        v = stack.shift()
        
        v0 = v.adjacent0
        v1 = v.adjacent1
        output.push [v0, v, v1]
        
        remove_links v
        
        v0_reflex = v0.reflex
        v1_reflex = v1.reflex
        
        stack.push v0 if not calc_reflex(v0, ref_normal) and v0_reflex
        stack.push v1 if not calc_reflex(v1, ref_normal) and v1_reflex
        
    output

  
  overlaps: (ex1, ex2) ->
    
    ex1.min[0] < ex2.max[0] and
    ex1.max[0] > ex2.min[0] and
    ex1.min[1] < ex2.max[1] and
    ex1.max[1] > ex2.min[1] and
    ex1.min[2] < ex2.max[2] and
    ex1.max[2] > ex2.min[2]
  
  overlaps2d: (ex1, ex2) ->
    ex1.min[0] < ex2.max[0] and
    ex1.max[0] > ex2.min[0] and
    ex1.min[1] < ex2.max[1] and
    ex1.max[1] > ex2.min[1]
  
  calc_extent: (vertices) ->
    max = min = vertices[0].toArray()
    for i in [1...vertices.length]
      v = vertices[i]
      max = [Math.max(v.x, max[0]), Math.max(v.y, max[1]), Math.max(v.z, max[2])]
      min = [Math.min(v.x, min[0]), Math.min(v.y, min[1]), Math.min(v.z, min[2])]
    
    min: min
    max: max
  
  
  
  class Polyhedron
    constructor: (@faces, @edges, @vertices) ->
    
      face.polyhedron = @ for face in @faces
      
      for edge in @edges
        edge.calc_interior()
        edge.polyhedron = @
    
      # calc extent
      @extent = @calc_extent(@vertices)
      
      
      for vertex in @vertices
        vertex.calc_interior()
        vertex.polyhedron = @
        
      
      
      @links = []
      
      
  class Face
    constructor: (@vertices, @edges, @plane) ->
      
      @extent = @calc_extent(@vertices)
        
      # calc plane equation
      unless @plane?
        [v1, v2, v3] = @vertices
        
        vec1 = v2.sub(v1)
        vec2 = v2.sub(v3)
        
        plane = Math.normalizeVector(Math.crossProduct(vec1, vec2))
        
        plane.push(plane[0] * v1.x + plane[1] * v1.y + plane[2] * v1.z)
        @plane = plane
      
      edge.adjoining_faces.push(@) for edge in @edges
  
  class Edge
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
      
  
  class Vertex
    constructor: (_vertex = [0,0,0]) ->
      @x = _vertex[0]
      @y = _vertex[1]
      @z = _vertex[2]
      
      @edges = []
      
      # null = unknown, -1 = outside, 0 = boundary, 1 = inside
      @status = null
      
      @adjacents = []
      
      @interior = true
    
    calc_interior: ->
      for edge in @edges
        return edge.interior = false unless edge.interior
      
    
    sub: (v2) ->
      [@x - v2.x, @y - v2.y, @z - v2.z]
      
    toArray: ->
      [@x, @y, @z]
    
    toString: ->
      @toArray().toString()
    
    equals: (a) ->
      @x == a.x and @y == a.y and @z == a.z

      
  
  split: (p1, p2) ->
    if @overlaps(p1.extent, p2.extent)
      for face1 in p1.faces
        if @overlaps(face1.extent, p2.extent)
          for face2 in p2.faces
            if @overlaps(face1.extent, face2.extent)
              @find_intersections(face1, face2)
  
  find_intersections: (face1, face2) ->
      
    distance_vertex_to_plane = (vertex, plane) ->
      if plane[3] < 0
        (vertex.x * (-plane[0]) + vertex.y * (-plane[1]) + vertex.z * (-plane[2])) + plane[3]
      else
        (vertex.x * plane[0] + vertex.y * plane[1] + vertex.z * plane[2]) - plane[3]
      
    distance_vertices_to_plane = (vertices, plane) ->
      for vertex in vertices
        s = distance_vertex_to_plane(vertex, plane)
        if max? and min?
          max = Math.max(max, s)
          min = Math.min(min, s)
        else
          max = min = s
      [max, min]
    
    line_segment = (_face1, _face2) ->
      points = []
      
      for v in _face1.vertices
        points.push v if distance_vertex_to_plane(v, _face2.plane) == 0
      
      return points if points.length == 2
      
      for e in _face1.edges
        v1 = e.vertices[0]
        v2 = e.vertices[1]
        d1 = distance_vertex_to_plane(v1, _face2.plane)
        d2 = distance_vertex_to_plane(v2, _face2.plane)
        
        if (d1 < 0 < d2) or (d1 > 0 > d2)
          d1 = Math.abs(d1)
          d2 = Math.abs(d2)
          vec = v2.sub(v1)
          quotient = (d1 / (d1 + d2))
          
          vertex = new Vertex [
            v1.x + quotient * vec[0]
            v1.y + quotient * vec[1]
            v1.z + quotient * vec[2]
          ]
          vertex.polyhedron = _face1.polyhedron
          vertex.interior = false unless e.interior
          vertex.linked_edge = e
          points.push vertex
      
      return points
      
    line_segment_intersection = (seg1, seg2) ->
      
      p = seg1[0]
      
      d1 = 0
      d2 = Math.vecLength(seg1[1].sub(p))
      d3 = Math.vecLength(seg2[0].sub(p))
      d4 = Math.vecLength(seg2[1].sub(p))
      
      if d1 > d2
        [d1, d2] = [d2, d1]
      if d3 > d4
        [d3, d4] = [d4, d3]
      
      if d3 > d2 # both segments don't intersect
        return [] 
      if d2 == d3 # they only touch in one point
        return [seg1[1]]
        
      [
        if d3 <= d1
          seg1[0]
        else # d1 < d3 < d2
          seg2[0]
       ,
        if d4 <= d2
          seg2[1]
        else # d3 < d2 < d4
          seg1[1]
      ]
      
      
    
    [max, min] = distance_vertices_to_plane(face1.vertices, face2.plane)
    
    if (max >= 0 and min >= 0) or (max <= 0 and min <= 0)
      return false # coplanar or no intersection at all
    else
      [max, min] = distance_vertices_to_plane(face2.vertices, face1.plane)
      
      if (max >= 0 and min >= 0) or (max <= 0 and min <= 0)
        return false # still no intersection
      else
        
        line_segment_intersection(
          line_segment(face1, face2),
          line_segment(face2, face1)
        )
  
  translateToXY: (vertices, normal) ->
    
    unless normal?
      normal = Math.crossProduct(vertices[1].sub(vertices[0]), vertices[2].sub(vertices[0])).map Math.abs 
    
    
    drop_index = if normal[2] >= normal[0] and normal[2] >= normal[1]
        2
      else if normal[1] >= normal[0] and normal[1] >= normal[2]
        1
      else
        0
    
    for v in vertices
      switch drop_index
        when 0
          v.dx = v.y
          v.dy = v.z
        when 1
          v.dx = v.x
          v.dy = v.z
        else
          v.dx = v.x
          v.dy = v.y

    vertices