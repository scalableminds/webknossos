### define ###
  
# Used for equality tests of numbers which require
# some tolerance because of numerical inconsistencies.
EPSILON = 1e-10

# Represents a convex polyhedron.
class Polyhedron

  constructor : (@polygons, @vertices) ->

  transform : (matrix) ->
    
    { vertices : oldVertices, polygons : oldPolygons } = @

    vertices = M4x4.transformPointsAffine(
      matrix, 
      oldVertices, 
      new Float64Array(oldVertices.length)
    )
    
    polygons = []
    for polygon in oldPolygons
      polygons.push(polygon.transform(matrix))

    new Polyhedron(polygons, vertices)

  scale : (factor) ->
    
    { vertices : oldVertices, polygons : oldPolygons } = @

    vertices = new Float64Array(oldVertices.length)
    i = vertices.length
    while i > 0
      vertices[--i] = oldVertices[i] * factor
    
    polygons = []
    for polygon in oldPolygons
      polygons.push(polygon.scale(factor))

    new Polyhedron(polygons, vertices)

  # Tests whether `point` is inside (including on the border)
  # of the polyhedron or not. `omittedPolygon` can be passed
  # to speed thungs up if you know that `point` is one that
  # polygon.
  isPointInside : (point, omittedPolygon) ->

    for polygon in @polygons when polygon != omittedPolygon
      if V3.dot(polygon.normal, point) - polygon.d > EPSILON
        return false
    true

  # Returns the minimum and maximum value of the polyhedron
  # in each dimension.
  extent : ->

    return @calculatedExtent if @calculatedExtent

    vertices = @vertices

    max_x = min_x = vertices[0] | 0
    max_y = min_y = vertices[1] | 0
    max_z = min_z = vertices[2] | 0
    for i in [3...vertices.length] by 3
      x = vertices[i]
      y = vertices[i + 1]
      z = vertices[i + 2]
      x = (x + if x >= 0 then EPSILON else -EPSILON) | 0
      y = (y + if y >= 0 then EPSILON else -EPSILON) | 0
      z = (z + if z >= 0 then EPSILON else -EPSILON) | 0
      max_x = if x > max_x then x else max_x
      max_y = if y > max_y then y else max_y
      max_z = if z > max_z then z else max_z
      min_x = if x < min_x then x else min_x
      min_y = if y < min_y then y else min_y
      min_z = if z < min_z then z else min_z
    
    # Our hard lower bound is always [0,0,0]
    min_x = if min_x < 0 then 0 else min_x
    min_y = if min_y < 0 then 0 else min_y
    min_z = if min_z < 0 then 0 else min_z
    max_x = if max_x < 0 then 0 else max_x
    max_y = if max_y < 0 then 0 else max_y
    max_z = if max_z < 0 then 0 else max_z

    @calculatedExtent = { min_x, min_y, min_z, max_x, max_y, max_z }


  # Returns an array of vertices which are inside of the
  # polyhedron. Only integer values are returned. Every
  # three values of the returned array represent a vertex.
  rasterize : ->
    
    { min_x, min_y, max_x, max_y } = @extent()

    # This is a vector parallel to the z-axis.
    v001 = new Float64Array(3)
    v001[2] = 1

    # Precomputing the dot product each polygon's normal
    # with v001. We need that value later for computing
    # the z boundaries. Also we can can remove polygons
    # that are parallel to the xy-plane, as they'll never
    # have one unique intersection with v001.
    polygons = []
    for polygon in @polygons
      divisor = V3.dot(v001, polygon.normal)
      unless -EPSILON <= divisor <= EPSILON
        polygon.divisor = divisor
        polygons.push(polygon)

    # We're reusing objects to make this code fast.
    vXY0 = new Float64Array(3)
    vXYZ = new Float64Array(3)
    vertices = []

    # Running through all x's and y's.
    for x in [min_x..max_x]
      vXY0[0] = x
      vXYZ[0] = x

      for y in [min_y..max_y]  
        vXY0[1] = y
        vXYZ[1] = y

        # Now we want to find both intersection points of the 
        # line parallel to the z-axis at x,y.
        start_z = end_z = null

        for polygon in polygons
          
          # We first calculate the intersection with each
          # polygon.
          z = ((polygon.d - V3.dot(vXY0, polygon.normal)) / polygon.divisor)
          vXYZ[2] = z
          
          # Then we'll make sure this intersection point is really
          # on the border of the polyhedron.
          if @isPointInside(vXYZ, polygon)
            z = (z + if z >= 0 then EPSILON else -EPSILON) | 0

            unless start_z?
              start_z = end_z = z
            else
              # throw "nooo" if start_z != end_z and 
              # start_z - EPSILON <= z <= start_z + EPSILON and 
              # end_z - EPSILON <= z <= end_z + EPSILON
              start_z = z if z < start_z
              end_z   = z if z > end_z 
        
        # Did we find z values for this xy?
        if start_z?
          if end_z >= 0
            start_z = 0 if start_z < 0
            
            for z in [start_z..end_z]
              vertices.push x, y, z
            
    new Float32Array(vertices)

  # Imports a polyhedron from an array data structure.
  # `polygonVertices` is assumed to be an array (polyhedron)
  # of arrays (polygonal face) of arrays (face vertices) of
  # numbers (coordinate).
  @load : (polygonVertices) ->
    
    polygons = []
    for face in polygonVertices
      polygons.push(new Polyhedron.Polygon(face))

    vertices = []
    for face in polygonVertices
      for vertex in face
        alreadyListed = false
        for i in [0...vertices.length] by 3
          if vertices[i] == vertex[0] and 
          vertices[i + 1] == vertex[1] and 
          vertices[i + 2] == vertex[2]
            alreadyListed = true
            break
        vertices.push(vertex[0], vertex[1], vertex[2]) unless alreadyListed

    new Polyhedron(polygons, new Float64Array(vertices))

  @buildCuboid : (center, radius) ->

    [c0, c1, c2] = center
    [r0, r1, r2] = radius

    @load [
      [ 2, 6, 4, 0 ]
      [ 5, 7, 3, 1 ]
      [ 4, 5, 1, 0 ]
      [ 3, 7, 6, 2 ]
      [ 1, 3, 2, 0 ]
      [ 6, 7, 5, 4 ]
    ].map (info) ->
      info.map (i) ->
        [
          c0 + r0 * (2 * !!(i & 1) - 1)
          c1 + r1 * (2 * !!(i & 2) - 1)
          c2 + r2 * (2 * !!(i & 4) - 1)
        ]




# Represents a polygon.
class Polyhedron.Polygon

  # Pass an array consisting of three-value arrays, each representing a
  # vertex, or just a flat array where each three values represent a vertex.
  # If you choose the second option you should set `isFlatArray` to `true`. 
  # Make sure the vertices are correctly ordered in counter-clockwise manner.
  # Otherwise the polygons' normal cannot be calculated correctly.
  #
  # The constructor turns the vertices list into a typed array and precomputes
  # the Hesse normal form.
  constructor : (vertices, isFlatArray) ->
    unless isFlatArray or not _.isArray(vertices[0])
      @vertices = _vertices = new Float64Array(vertices.length * 3)
      i = j = 0
      while i < vertices.length
        vertex = vertices[i++]
        _vertices[j++] = vertex[0]
        _vertices[j++] = vertex[1]
        _vertices[j++] = vertex[2]
    
      @normal = V3.cross(
        V3.sub(vertices[0], vertices[1], new Float64Array(3)), 
        V3.sub(vertices[2], vertices[1], new Float64Array(3)), 
        new Float64Array(3)
      )
      
      @d = V3.dot(vertices[0], @normal)
    
    else
      @vertices = vertices

      vec1 = new Float64Array(3)
      vec1[0] = vertices[0]
      vec1[1] = vertices[1]
      vec1[2] = vertices[2]

      vec2 = new Float64Array(3)
      vec2[0] = vertices[3]
      vec2[1] = vertices[4]
      vec2[2] = vertices[5]

      vec3 = new Float64Array(3)
      vec3[0] = vertices[6]
      vec3[1] = vertices[7]
      vec3[2] = vertices[8]

      @normal = V3.cross(
        V3.sub(vec1, vec2, new Float64Array(3)), 
        V3.sub(vec3, vec2, new Float64Array(3)), 
        new Float64Array(3)
      )

      @d = V3.dot(vec3, @normal)

  # Transform the polygon using a transformation matrix.
  transform : (matrix) ->
    new Polygon(
      M4x4.transformPointsAffine(matrix, @vertices, new Float64Array(@vertices.length)),
      true
    )

  scale : (factor) ->

    oldVertices = @vertices

    vertices = new Float64Array(oldVertices.length)
    i = vertices.length
    while i > 0
      vertices[--i] = oldVertices[i] * factor

    new Polygon(vertices, true)


Polyhedron