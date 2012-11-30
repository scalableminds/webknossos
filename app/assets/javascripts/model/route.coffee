### define
jquery : $
underscore : _
../libs/request : Request
../libs/event_mixin : EventMixin
./tracepoint : TracePointClass
###

# This takes care of the route. 
  
# Constants
BUFFER_SIZE = 262144 # 1024 * 1204 / 4
PUSH_THROTTLE_TIME = 30000 # 30s
INIT_TIMEOUT = 10000 # 10s
TYPE_USUAL = 0
TYPE_BRANCH = 1

class Route
  
  branchStack : []
  trees : []
  activeNode : null
  activeTree : null

  constructor : (@data) ->

    _.extend(this, new EventMixin())

    #@branchStack = @data.branchPoints.map (a) -> new Float32Array(a)
    #@branchStack = (@data.trees[branchPoint.treeId].nodes[branchPoint.id].position for branchPoint in @data.branchPoints) # when @data.trees[branchPoint.treeId]?.id? == branchPoint.treeId)

    @idCount = 1
    @treeIdCount = 1
    @trees = []
    @activeNode = null
    # Used to save in NML file, is always defined
    @lastActiveNodeId = 1
    @activeTree = null

    # For trees that are disconnected
    lostTrees = []

    ############ Load Tree from @data ##############
    
    @scale = @data.scale
    # reciprocal of scale
    @voxelPerNM = [0, 0, 0]
    for i in [0..(@scale.length - 1)]
      @voxelPerNM[i] = 1 / @scale[i]
    @scaleX = @data.scale[0]
    @globalPosition = data.editPosition

    # get tree to build
    for tree in @data.trees
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
      activeNodeT = @findNodeInList(nodes, @data.activeNode)
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
    for branchpoint in @data.branchPoints
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
        @pushBranch()
        @pushImpl()
    )

  # Returns an object that is structured the same way as @data is
  exportToNML : ->
    result = @data
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
    @push = _.throttle(_.mutexDeferred(@pushImpl, -1), PUSH_THROTTLE_TIME)
    @push()

  pushImpl : ->

    deferred = new $.Deferred()

    Request.send(
      url : "/tracing/#{@data.id}"
      method : "PUT"
      data : @exportToNML()
      contentType : "application/json"
    )
    .fail =>
      @push()
      deferred.reject()
    .done =>
      deferred.resolve()

  # INVARIANTS:
  # activeTree: either sentinel (activeTree.isSentinel==true) or valid node with node.parent==null
  # activeNode: either null only if activeTree is empty (sentinel) or valid node

  pushBranch : ->

    if @activeNode
      @branchStack.push(@activeNode)
      @activeNode.type = TYPE_BRANCH

      @trigger("setBranch", true)

  popBranch : ->

    point = @branchStack.pop()
    @push()
    deferred = new $.Deferred()
    if point
      @activeNode = point
      @activeNode.type = TYPE_USUAL

      @trigger("setBranch", false)

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
    # { branchStack } = @

    #if branchStack.length > 0
    #  @addToBuffer(2)
      #deferred.resolve(branchStack.pop())
    #  deferred.resolve(@activeNode.pos)
    #else
    #  deferred.reject()

  addNode : (position, type) ->
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

    @trigger("newNode")

  getActiveNodeId : ->

    @lastActiveNodeId


  getActiveNodePos : ->

    if @activeNode then @activeNode.pos else null


  getActiveNodeType : ->

    if @activeNode then @activeNode.type

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

    @trigger("newActiveNode")


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

    @trigger("newActiveTree")

  getNewTreeColor : ->
    switch @treeIdCount
      when 1 then return 0xFF0000
      when 2 then return 0x00FF00
      when 3 then return 0x0000FF
      when 4 then return 0xFF00FF
      when 5 then return 0xFFFF00
      else  
        new THREE.Color().setHSV(Math.random(), 1, 1).getHex()

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

    @trigger("newTree", sentinel.treeId, sentinel.color)

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

    @trigger("deleteActiveNode")

  deleteActiveTree : ->
    # There should always be an active Tree
    # Find index of activeTree
    for i in [0..@trees.length]
      if @trees[i].treeId == @activeTree.treeId
        index = i
        break
    @trees.splice(index, 1)
    # Because we always want an active tree, check if we need
    # to create one.
    if @trees.length == 0
      @createNewTree()
    else
      # just set the last tree to be the active one
      @setActiveTree(@trees[@trees.length - 1].treeId)
    @push()

    @trigger("deleteActiveTree")

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
