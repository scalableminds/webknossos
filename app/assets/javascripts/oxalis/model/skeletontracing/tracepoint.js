

class TracePoint

  constructor : (@id, @pos, @radius, @treeId, @metaInfo, @rotation) ->

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


  buildTree : (parent = null) ->

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

    # Make sure you only look once at every node. Assumes
    # that @_seen does not exist or has been initialized
    # to false for all nodes
    if @_seen
      throw "CyclicTree"
    @_seen = true

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

module.exports = TracePoint
