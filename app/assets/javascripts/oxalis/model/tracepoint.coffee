TYPE_USUAL  = 0
TYPE_BRANCH = 1

# This class should represent a Trace Point
class TracePoint

  constructor : (@type, @id, @pos, @radius) ->
    @neighbors = []

  appendNext : (next) ->
    @neighbors.push(next)

  getNext : (parent) ->

    if parent? then minN = 2 else minN = 1

    if @neighbors.length < minN
      return null

    if @neighbors.length == minN
      for neighbor in @neighbors
        if neighbor != parent
          return neighbor
          
    res = []
    for neighbor in @neighbors
      if neighbor != parent
        res.push(neighbor)
    return res

  removeNeighbor : (id) ->
    for i in [0...@neighbors.length]
      if @neighbors[i].id == id
        # Remove neighbor
        @neighbors.splice(i, 1)
        return