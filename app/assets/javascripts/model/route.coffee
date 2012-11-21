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

<<<<<<< HEAD
  dataSet : null
  experiment : null
  experiments : null
=======
  # Initializes this module and returns a position to start your work.
  initialize : _.once ->

    Game.initialize().pipe =>

      _.extend(this, new EventMixin())

      $.get("/tracing/#{Game.task.id}",
        (data) =>
          Route.data = data
          
>>>>>>> c9ad73e019f74ff23ac51dd852dcfbb1c6a4e8f9

  # Initializes this module and returns a position to start your work.
  constructor : (@data) ->

    _.extend(this, new EventMixin())

    console.log "Route.data:"
    console.log data
    @id        = data.dataSet.id
    #@branchStack = data.tracing.branchPoints.map (a) -> new Float32Array(a)
    #@branchStack = (data.tracing.trees[branchPoint.treeId].nodes[branchPoint.id].position for branchPoint in data.tracing.branchPoints) # when data.tracing.trees[branchPoint.treeId]?.id? == branchPoint.treeId)
    @createBuffer()

    @idCount = 1
    @treeIdCount = 1
    @trees = []
    @activeNode = null
    # Used to save in NML file, is always defined
    @lastActiveNodeId = 1
    @activeTree = null
    
    # Build sample tree
    #@putNewPoint([300, 300, 200], TYPE_USUAL)
    #branch = @putNewPoint([300, 320, 200], TYPE_BRANCH)
    #@putNewPoint([340, 340, 200], TYPE_USUAL)
    #@putNewPoint([360, 380, 200], TYPE_USUAL)
    #@activeNode = branch
    #branch = @putNewPoint([340, 280, 200], TYPE_BRANCH)
    #@putNewPoint([360, 270, 200], TYPE_USUAL)
    #@activeNode = branch
    #@putNewPoint([360, 290, 200], TYPE_USUAL)
    #console.log "--------- TREE ---------"
    #console.log @tree.toString()

    # Build sample data.tracing
    #console.log "---------- Build data.tracing -----------"
    #console.log data.tracing
    #data.tracing = {
    #  activeNode : 6
    #  branchPoints : [{id : 1}, {id : 2}]
    #  editPosition : [400, 350, 200]
    #  id : "5029141a44aebdd7a089a062"
    #  trees : {
    #    1 : {
    #      color : [1, 0, 0, 0]
    #      edges : [{source : 1, target : 3},
    #               {source : 3, target : 4},
    #               {source : 1, target : 2},
    #               {source : 2, target : 5},
    #               {source : 2, target : 6},
    #               {source : 2, target : 7}]
    #      id : 1
    #      nodes : {
    #        1 : { id : 1, position : [300, 300, 200], radius : 1}
    #        2 : { id : 2, position : [350, 350, 200], radius : 1}
    #        3 : { id : 3, position : [300, 350, 200], radius : 1}
    #        4 : { id : 4, position : [300, 400, 200], radius : 1}
    #        5 : { id : 5, position : [400, 300, 200], radius : 1}
    #        6 : { id : 6, position : [400, 350, 200], radius : 1}
    #        7 : { id : 7, position : [400, 400, 200], radius : 1}
    #      }
    #    }
    #    5 : {
    #      color : [1, 0, 0, 0]
    #      edges : [{source : 8, target : 9},
    #               {source : 9, target : 10}]
    #      id : 2
    #      nodes : {
    #        8 : { id : 8, position : [350, 400, 200], radius : 1}
    #        9 : { id : 9, position : [400, 450, 200], radius : 1}
    #        10 : { id : 10, position : [350, 450, 200], radius : 1}
    #      }
    #    }
    #  }
    #}
    console.log "data.tracing:"
    console.log data.tracing

    #@recursionTest(0)

    # For trees that are disconnected
    lostTrees = []

    ############ Load Tree from data.tracing ##############
    @scaleX = data.tracing.scale[0]
    @globalPosition = data.tracing.editPosition
    # get tree to build
    for tree in data.tracing.trees
      # Initialize nodes
      nodes = []
      i = 0
      treeColor = new THREE.Color().setRGB(tree.color[0..2]...).getHex()
      for node in tree.nodes
        if node
          nodes.push(new TracePoint(null, TYPE_USUAL, node.id, node.position, node.radius, treeColor))
      # Initialize edges
      for edge in tree.edges
        sourceNode = @findNodeInList(nodes, edge.source)
        targetNode  = @findNodeInList(nodes, edge.target)
        sourceNode.appendNext(targetNode)
        targetNode.parent = sourceNode
      # Find root (only node without parent)
      treeFound = false
      for node in nodes
        unless node.parent
          if treeFound == true
            lostTrees.push(node)
          else
            node.treeId = tree.id
            @trees.push(node)
            treeFound = true
      # Set active Node
      activeNodeT = @findNodeInList(nodes, data.tracing.activeNode)
      if activeNodeT
        @activeNode = activeNodeT
        @lastActiveNodeId = @activeNode.id
        # Active Tree is the one last added
        @activeTree = @trees[@trees.length - 1]
      # Set idCount
      for node in nodes
        @idCount = Math.max(node.id + 1, @idCount);
    
    # Set branchpoints
    nodeList = @getNodeListOfAllTrees()
    for branchpoint in data.tracing.branchPoints
      node = @findNodeInList(nodeList, branchpoint.id)
      if node
        node.type = TYPE_BRANCH
        @branchStack.push(node)
      
    for tree in @trees
      @treeIdCount = Math.max(tree.treeId + 1, @treeIdCount)
    for tree in lostTrees
      savedActiveNode = @activeNode
      @createNewTree()
      # Restore active node
      @activeNode = savedActiveNode
      tree.treeId = @activeTree.treeId
      @trees[@activeTree.treeIndex] = tree
      @activeTree = tree
    unless @activeTree
      if @trees.length > 0
        @activeTree = @trees[0]
      else
        @createNewTree()

    $(window).on(
      "unload"
      => 
        @putBranch(@lastPosition) if @lastPosition
        @pushImpl()
    )

    deferred.resolve(data.tracing.editPosition)
    )

  # Returns an object that is structured the same way as data.tracing is
  exportToNML : ->
    result = Route.data.tracing
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
        treeColor = new THREE.Color(tree.color)
        treeObj.color = [treeColor.r, treeColor.g, treeColor.b, 1]
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
          url : "/tracing/#{Game.task.id}"
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
    point = new TracePoint(@activeNode, type, @idCount++, position, @lastRadius, @activeTree.color)
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

  getNewTreeColor : ->
    +("0x"+("000"+(Math.random()*(1<<24)|0).toString(16)).substr(-6))

  createNewTree : ->
    # Because a tree is represented by the root element and we
    # don't have any root element, we need a sentinel to save the
    # treeId and it's index within trees.
    treeColor = @getNewTreeColor()
    sentinel = new TracePoint(null, null, null, null, null, treeColor)
    sentinel.treeId = @treeIdCount++
    # save Index, so we can access it once we have the root element
    sentinel.treeIndex = @trees.length
    sentinel.isSentinel = true
    @trees.push(sentinel)
    @activeTree = sentinel
    @activeNode = null
    @push()
    return [sentinel.treeId, sentinel.color]

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