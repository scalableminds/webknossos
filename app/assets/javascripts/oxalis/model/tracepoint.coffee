### define ###

TYPE_USUAL  = 0
TYPE_BRANCH = 1

# This class should represent a Trace Point
class TracePoint

  constructor : (@type, @id, @pos, @radius, @time, @treeId) ->
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

  buildTree : (parent = null) =>
    @setChildRelation(parent)

    childrenIterator = @children
    parentIterator   = @
    
    while childrenIterator.length == 1
      childrenIterator[0].setChildRelation(parentIterator)
      parentIterator = childrenIterator[0]
      childrenIterator = parentIterator.children
    
    for child in childrenIterator
      child.buildTree(parentIterator)

  setChildRelation : (@parent) =>
    @children = @getNext(@parent)
    unless @children?
      @children = []
    unless _.isArray(@children)
      @children = [@children]

  removeNeighbor : (id) ->
    for i in [0...@neighbors.length]
      if @neighbors[i].id == id
        # Remove neighbor
        @neighbors.splice(i, 1)
        return