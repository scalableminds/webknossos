### define ###

# This creates a Trianglesplane
# It is essentially a square with a grid of vertices. Those vertices are
# connected through triangles. Cuz that's how u do it in WebGL.

SPHERICAL_CAP_RADIUS = 140

Trianglesplane = 

  get : (width, zOffset) ->
    
    deferred = $.Deferred()

    _.defer ->
      
      bufferLength = width * width * 3

      # so we have Point [0 0 0] centered
      startIndex = - Math.floor width/2
      endIndex   = startIndex + width
      endIndex1  = endIndex - 1
      
      # Each three elements represent one vertex.
      normalVertices = new Float32Array(bufferLength)
      queryVertices  = new Float32Array(bufferLength)

      # Each three elements represent one triangle.
      # Those triangles are being connected through this
      # indices. And each vertex is connected through two 
      # triangles.
      indices = new Uint16Array(bufferLength << 2)
      currentPoint = 0
      currentIndex = 0

      for y in [startIndex...endIndex]
        for x in [startIndex...endIndex]
          currentIndex2 = currentIndex << 1

          # We don't draw triangles with the last point of an axis.
          if y < endIndex1 and x < endIndex1
            indices[currentIndex2]     = currentPoint
            indices[currentIndex2 + 1] = indices[currentIndex2 + 5] = currentPoint + 1 
            indices[currentIndex2 + 2] = indices[currentIndex2 + 3] = currentPoint + width
            indices[currentIndex2 + 4] = currentPoint + width + 1

          normalVertices[currentIndex]     = x
          normalVertices[currentIndex + 1] = y
          normalVertices[currentIndex + 2] = zOffset

          currentPoint++
          currentIndex += 3
      

      # Transforming those normalVertices to become a spherical cap
      # which is better more smooth for querying.
      # http://en.wikipedia.org/wiki/Spherical_cap
      centerVertex    = new Float32Array(3)
      centerVertex[2] = zOffset - SPHERICAL_CAP_RADIUS

      i = 0
      vertex  = new Float32Array(3)
      vec2 = new Float32Array(3)

      while i < bufferLength
        vertex[0] = normalVertices[i]
        vertex[1] = normalVertices[i + 1]
        vertex[2] = normalVertices[i + 2]

        vec2   = V3.sub(vertex, centerVertex, vec2)
        length = V3.length(vec2)
        vec2   = V3.scale(vec2, SPHERICAL_CAP_RADIUS / length, vec2)
        V3.add(centerVertex, vec2, vertex)

        queryVertices[i++] = vertex[0]
        queryVertices[i++] = vertex[1]
        queryVertices[i++] = vertex[2]


      deferred.resolve { normalVertices, queryVertices, indices }
    
    deferred.promise()