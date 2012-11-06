### define
jquery : $
underscore : _
libs/request : request
libs/event_mixin : EventMixin
libs/json_socket : JsonSocket
model/game : Game
model/tracepoint : TracePointClass
###

# This takes care of the route. 
  
# Constants
BUFFER_SIZE = 262144 # 1024 * 1204 / 4
PUSH_THROTTLE_TIME = 30000 # 30s
INIT_TIMEOUT = 10000 # 10s

TYPE_USUAL  = 0
TYPE_BRANCH = 1

class Route
  
  # Variables
  branchStack : []
  trees : []
  activeNode : null
  activeTree : null

  dataSet : null
  experiment : null
  experiments : null

  # Initializes this module and returns a position to start your work.
  constructor : (@dataSet, @experiment, @experiments) ->

    _.extend(this, new EventMixin())

  # Returns an object that is structured the same way as data.experiment is
  exportToNML : ->
    result = Route.data.experiment
    result.activeNode = @lastActiveNodeId
    result.branchPoints = []
    # Get Branchpoints
    for branchPoint in @branchStack
      result.branchPoints.push({id : branchPoint.id})
    result.editPosition = @globalPosition
    result.trees = []
    for tree in @trees
      # Don't save empty trees (id is null)
      if tree.id
        nodes = @getNodeList(tree)
        treeObj = {}
        result.trees.push(treeObj)
        treeObj.color = [1, 0, 0, 0]
        treeObj.edges = []
        # Get Edges
        for node in nodes
          for child in node.getChildren()
            treeObj.edges.push({source : node.id, target : child.id})
        treeObj.id = tree.treeId
        treeObj.nodes = []
        # Get Nodes
        for node in nodes
          treeObj.nodes.push({
            id : node.id
            position : node.pos
            radius : node.size
            # TODO: Those are dummy values
            viewport : 0
            timestamp : 0
            resolution : 0
          })

    console.log "NML-Objekt"
    console.log result
    return result


  # Pushes the buffered route to the server. Pushing happens at most 
  # every 30 seconds.
  push : ->
    console.log "push()"
    @push = _.throttle(_.mutexDeferred(@pushImpl, -1), PUSH_THROTTLE_TIME)
    @push()

  pushImpl : ->

    console.log "pushing..."

    deferred = new $.Deferred()

    @initialize().pipe =>

      request(
          url : "/experiment/#{Game.task.id}"
          method : "PUT"
          data : @exportToNML()
          contentType : "application/json"
        )
      .fail =>
        @push()
        deferred.reject()
      .done =>
        deferred.resolve()

  createBuffer : ->
    @bufferIndex = 0
    @buffer = new Float32Array(BUFFER_SIZE)

  addToBuffer : (typeNumber, value) ->

    @buffer[@bufferIndex++] = typeNumber

    if value and typeNumber != 2
      @buffer.set(value, @bufferIndex)
      @bufferIndex += 3

    #console.log @buffer.subarray(0, 50)

    @push()

  # INVARIANTS:
  # activeTree: either sentinel (activeTree.isSentinel==true) or valid node with node.parent==null
  # activeNode: either null only if activeTree is empty (sentinel) or valid node

  putBranch : ->

    @initialize().done =>
      
      #@addToBuffer(1, position)
      if @activeNode
        @branchStack.push(@activeNode)
        @activeNode.type = TYPE_BRANCH

      #@putNewPoint(position, TYPE_BRANCH)

    return

  popBranch : ->

    @initialize().pipe =>

      
      point = @branchStack.pop()
      @push()
      deferred = new $.Deferred()
      if point
        @activeNode = point
        @activeNode.type = TYPE_USUAL
        @lastActiveNodeId = @activeNode.id
        deferred.resolve(@activeNode.id)
      else
        deferred.reject()

      #savedActiveNode = @activeNode
      #if @activeNode
      #  while (true)
      #    @activeNode = @activeNode.parent
      #    unless @activeNode
      #      break
      #    if (@activeNode.type == TYPE_BRANCH)
      #      break
      #deferred = new $.Deferred()
      #unless @activeNode
      #  @activeNode = savedActiveNode
      #  deferred.reject()
      #else
      #  deferred.resolve(@activeNode.pos)
      
      
      # Georg doesn't get the following lines
      #{ branchStack } = @

      #if branchStack.length > 0
      #  @addToBuffer(2)
        #deferred.resolve(branchStack.pop())
      #  deferred.resolve(@activeNode.pos)
      #else
      #  deferred.reject()

  # Add a point to the buffer. Just keep adding them.
  put : (position) ->

    @initialize().done =>

      position = V3.round(position, position)
      lastPosition = @lastPosition

      if not lastPosition or 
      lastPosition[0] != position[0] or 
      lastPosition[1] != position[1] or 
      lastPosition[2] != position[2]
        @lastPosition = position
        @addToBuffer(0, position)

      @putNewPoint(position, TYPE_USUAL)
      @push()

    return

  putNewPoint : (position, type) ->
    unless @lastRadius
      @lastRadius = 10 * @scaleX
    point = new TracePoint(@activeNode, type, @idCount++, position, @lastRadius, 1)
    if @activeNode
      @activeNode.appendNext(point)
    else
      # Tree has to be empty, so replace sentinel with point
      point.treeId = @activeTree.treeId
      @trees[@activeTree.treeIndex] = point
      @activeTree = point
      @activeTree.parent = null
    @activeNode = point
    @lastActiveNodeId = @activeNode.id

  getActiveNodeId : ->
    @lastActiveNodeId

  getActiveNodePos : ->
    unless @activeNode then return null
    @activeNode.pos

  getActiveNodeType : ->
    unless @activeNode then return null
    @activeNode.type

  getActiveNodeRadius : ->
    unless @activeNode then return null
    @activeNode.size

  getActiveTreeId : ->
    unless @activeTree then return null
    @activeTree.treeId

  setActiveNodeRadius : (radius) ->
    if @activeNode
      @activeNode.size = radius
      @lastRadius = radius
    @push()

  setActiveNode : (id) ->
    for tree in @trees
      findResult = @findNodeInTree(id, tree)
      if findResult
        @activeNode = findResult
        @lastActiveNodeId = @activeNode.id
        @activeTree = tree
        break
    @push()
    return @activeNode.pos

  setActiveTree : (id) ->
    for tree in @trees
      if tree.treeId == id
        @activeTree = tree
        break
    if @activeTree.isSentinel
      @activeNode = null
    else
      @activeNode = @activeTree
      @lastActiveNodeId = @activeNode.id
    @push()

  createNewTree : ->
    # Because a tree is represented by the root element and we
    # don't have any root element, we need a sentinel to save the
    # treeId and it's index within trees.
    sentinel = new TracePoint(null, null, null, null, null, null)
    sentinel.treeId = @treeIdCount++
    # save Index, so we can access it once we have the root element
    sentinel.treeIndex = @trees.length
    sentinel.isSentinel = true
    @trees.push(sentinel)
    @activeTree = sentinel
    @activeNode = null
    @push()
    return sentinel.treeId

  findNodeInTree : (id, tree) ->
    unless tree
      tree = @activeTree
    if tree.id == id then tree else tree.findNodeById(id, tree)

  deleteActiveNode : ->
    unless @activeNode
      return
    id = @activeNode.id
    @activeNode = @activeNode.parent
    if @activeNode
      @activeNode.remove(id)
      @lastActiveNodeId = @activeNode.id
    else
      # Root is deleted
      @deleteActiveTree()
    @push()

  deleteActiveTree : ->
    # There should always be an active Tree
    # Find index of activeTree
    for i in [0..@trees.length]
      if @trees[i].treeId == @activeTree.treeId
        index = i
        break
    @trees.splice(index, 1)
    console.log @trees
    # Because we always want an active tree, check if we need
    # to create one.
    if @trees.length == 0
      @createNewTree()
    else
      # just set the last tree to be the active one
      @setActiveTree(@trees[@trees.length - 1].treeId)
    @push()

  getTree : (id) ->
    unless id
      return @activeTree
    for tree in @trees
      if tree.treeId == id
        return tree
    return null

  getTrees : ->
    @trees

  getNodeList : (tree) ->
    unless tree
      tree = @activeTree
    result = [tree]
    for c in tree.getChildren()
      if c
        result = result.concat(@getNodeList(c))
    return result

  getNodeListOfAllTrees : ->
    result = []
    for tree in @trees
      result = result.concat(@getNodeList(tree))
    return result

  # Helper method used in initialization
  findNodeInList : (list, id) ->
    for node in list
      if node.id == id
        return node
    return null

  # Just to check how far we can go. I (Georg) had a call
  # stack of about 20,000
  recursionTest : (counter) ->
    console.log(counter++)
    return @recursionTest(counter)