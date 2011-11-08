class Geometry
  constructor: () ->
    @polyhedral = []
  
  load: (data) ->
    
    vertices = {}
    for polygon in data
      for _vertex in polygon
        vertices[_vertex.toString()] = new Vertex(_vertex)
    
    polyhedron = new Polyhedron(
      for polygon in data
        new Polygon(
          for _vertex in polygon
            vertices[_vertex.toString()];
        )
      ,
      Object.keys(vertices).map (a) -> vertices[a]
    )
    delete vertices
    @polyhedral.push polyhedron
    
  
  overlaps = (ex1, ex2) ->
    
    point_in_cube(p, cube) ->
      cube.min[0] < p[0] < cube.max[0] and 
      cube.min[1] < p[1] < cube.max[1] and 
      cube.min[2] < p[2] < cube.max[2]
    
    point_in_cube(ex1.min, ex2) or 
    point_in_cube(ex1.max, ex2) or 
    point_in_cube(ex2.min, ex1) or 
    point_in_cube(ex2.max, ex1)
  
  calc_extent = (vertex, max, min) ->
    
    unless max? or min?
      [vertex.to_a(), vertex.to_a()]
    else
      [
        [Math.max(vertex.x, max[0]), Math.max(vertex.y, max[1]), Math.max(vertex.z, max[2])]
        [Math.min(vertex.x, min[0]), Math.min(vertex.y, min[1]), Math.min(vertex.z, min[2])]
      ]
  
  class Polyhedron
    constructor: (@polygons, @vertices) ->
    
      # calc extent
      for vertex in @vertices
        [max, min] = calc_extent(vertex, max, min)
      
      @extent =
        max: max
        min: min
    
    splitFrom: (objectB) ->
      if overlaps(@extent, objectB.extent)
        for polygonA in @polygons
          if overlaps(polygonA.extent, objectB.extent)
            for polygonB in objectB.polygons
              if overlaps(polygonA.extent, polygonB.extent)
                [coplanar, intersect] = polygonA.is_intersect(polygonB)
                @polygons.push(polygonA.subdivide(polygonB)...) if !coplanar and intersect
      
  class Polygon
    constructor: (@vertices) ->
      
      # calc extent
      for vertex in @vertices
        [max, min] = calc_extent(vertex, max, min)
        
      @extent =
        max: max
        min: min
      
      # calc plane equation
      [v1, v2, v3] = @vertices[0..2]
      
      vec1 = v2.sub(v1)
      vec2 = v2.sub(v3)
      
      plane = [
        vec1[1] * vec2[2] - vec1[2] * vec2[1]
        vec1[2] * vec2[0] - vec1[0] * vec2[2]
        vec1[0] * vec2[1] - vec1[1] * vec2[0]
      ]
      plane = Math.normalizeVector(plane)
      
      plane.push(plane[0] * v1.x + plane[1] * v1.y + plane[2] * v1.z)
      @plane = plane
    
    is_intersect: (polygonB) ->
      
      distance_vertices_to_plane = (vertices, plane) ->
        for vertex in vertices
          s = (vertex.x * plane[0] + vertex.y * plane[1] + vertex.z * plane[2]) - plane[3]
          if max? and min?
            max = Math.max(max, s)
            min = Math.min(min, s)
          else
            max = min = s
      
      [max, min] = distance_vertices_to_plane(@vertices, polygonB.plane)
      
      if max == 0 and min == 0
        return [true, false] # coplanar
      else if (max >= 0 and min >= 0) or (max <= 0 and min <= 0)
        return [false, false] # not coplanar, but no intersection
      else
        [max, min] = distance_vertices_to_plane(polygonB.vertices, @plane)
        
        if (max >= 0 and min >= 0) or (max <= 0 and min <= 0)
          return [false, false] # still no intersection
        else if max == 0 and min == 0
          throw new Error("this cannot be")
        else
          
          
      
    subdivide: (polygonB) ->
      
      
    
  class Vertex
    constructor: (_vertex = [0,0,0]) ->
      @x = _vertex[0]
      @y = _vertex[1]
      @z = _vertex[2]
      
      # null = unknown, -1 = outside, 0 = boundary, 1 = inside
      @status = null
      
      @adjacents = []
    
    sub: (v2) ->
      [@x - v2.x, @y - v2.y, @z - v2.z]
      
    to_a: ->
      [@x, @y, @z]
      
  subdivide: (p1, p2) ->
    p1.splitFrom(p2)
    p2.splitFrom(p1)
    p1.splitFrom(p2)
