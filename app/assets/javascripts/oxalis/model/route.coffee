### define
jquery : $
underscore : _
../../libs/request : Request
../../libs/event_mixin : EventMixin
./tracepoint : TracePoint
./tracetree : TraceTree
./statelogger : StateLogger
../constants : constants
libs/threejs/ColorConverter : ColorConverter
###

class Route

  GOLDEN_RATIO : 0.618033988749895
  TYPE_USUAL   : constants.TYPE_USUAL
  TYPE_BRANCH  : constants.TYPE_BRANCH
  # Max and min radius in base voxels (see scaleInfo.baseVoxel)
  MIN_RADIUS        : 1
  MAX_RADIUS        : 1000
  
  branchStack : []
  trees : []
  comments : []
  activeNode : null
  activeTree : null
  firstEdgeDirection : null

  constructor : (@data, @scaleInfo, @flycam, @flycam3d, @user) ->

    _.extend(this, new EventMixin())

    @idCount = 1
    @treeIdCount = 1
    @trees = []
    @comments = []
    @activeNode = null
    # Used to save in NML file, is always defined
    @lastActiveNodeId = 1
    @activeTree = null

    # For trees that are disconnected
    lostTrees = []

    @doubleBranchPop = false

    # initialize deferreds
    @finishedDeferred = new $.Deferred().resolve()

    ############ Load Tree from @data ##############

    @stateLogger = new StateLogger(this, @flycam, @data.version, @data.id, @data.settings.isEditable)
    console.log "Tracing data: ", @data

    # get tree to build
    for treeData in @data.trees
      # Create new tree
      tree = new TraceTree(
        treeData.id,
        @getNewTreeColor(treeData.id),
        if treeData.name then treeData.name else "Tree#{('00'+treeData.id).slice(-3)}")
      # Initialize nodes
      i = 0
      for node in treeData.nodes
        if node
          tree.nodes.push(new TracePoint(@TYPE_USUAL, node.id, node.position, node.radius, node.timestamp, treeData.id))
          # idCount should be bigger than any other id
          @idCount = Math.max(node.id + 1, @idCount);
      # Initialize edges
      for edge in treeData.edges
        sourceNode = @findNodeInList(tree.nodes, edge.source)
        targetNode = @findNodeInList(tree.nodes, edge.target)
        if sourceNode and targetNode
          sourceNode.appendNext(targetNode)
          targetNode.appendNext(sourceNode)
        else
          $.assertNotEquals(sourceNode, null, "source node undefined",
            {"edge" : edge})
          $.assertNotEquals(targetNode, null, "target node undefined",
            {"edge" : edge})

      # Set active Node
      activeNodeT = @findNodeInList(tree.nodes, @data.activeNode)
      if activeNodeT
        @activeNode = activeNodeT
        @lastActiveNodeId = @activeNode.id
        # Active Tree is the one last added
        @activeTree = tree

      @treeIdCount = Math.max(tree.treeId + 1, @treeIdCount)
      @trees.push(tree)
    
    # Set branchpoints
    nodeList = @getNodeListOfAllTrees()
    for branchpoint in @data.branchPoints
      node = @findNodeInList(nodeList, branchpoint.id)
      if node?
        node.type = @TYPE_BRANCH
        @branchStack.push(node)

    # Set comments
    for comment in @data.comments
      comment.node = @findNodeInList(nodeList, comment.node)
    @comments = @data.comments

    unless @activeTree
      if @trees.length > 0
        @activeTree = @trees[0]
      else
        @createNewTree()

    tracingType = data.tracingType
    if (tracingType == "Task" or tracingType == "Training") and nodeList.length == 0
      @addNode(data.editPosition)

    @branchPointsAllowed = @data.settings.branchPointsAllowed
    if not @branchPointsAllowed
      # dirty but this actually is what needs to be done
      @TYPE_BRANCH = @TYPE_USUAL


      #calculate direction of first edge in nm
      if @data.trees[0]?.edges?
        for edge in @data.trees[0].edges
          sourceNode = @findNodeInList(@trees[0].nodes, edge.source).pos
          targetNode = @findNodeInList(@trees[0].nodes, edge.target).pos
          if sourceNode[0] != targetNode[0] or sourceNode[1] != targetNode[1] or sourceNode[2] != targetNode[2]
            @firstEdgeDirection = [targetNode[0] - sourceNode[0],
                                   targetNode[1] - sourceNode[1],
                                   targetNode[2] - sourceNode[2]]
            break

      if @firstEdgeDirection
        @flycam.setSpaceDirection(@firstEdgeDirection)
        @flycam3d.setDirection(@firstEdgeDirection)

    #@createNewTree()
    #for i in [0...10000]
    #  @addNode([Math.random() * 2000, Math.random() * 2000, Math.random() * 2000], TYPE_USUAL)

    $(window).on(
      "beforeunload"
      =>
        if !@stateLogger.stateSaved() and @stateLogger.isEditable
          @stateLogger.pushImpl(false)
          return "You haven't saved your progress, please give us 2 seconds to do so and and then leave this site."
        else
          return
    )

  pushNow : ->

    @stateLogger.pushNow()


  pushBranch : ->

    if @branchPointsAllowed
      if @activeNode
        @branchStack.push(@activeNode)
        @activeNode.type = @TYPE_BRANCH
        @stateLogger.push()

        @trigger("setBranch", true)
    else
      @trigger("noBranchPoints")


  popBranch : ->

    deferred = new $.Deferred()
    if @branchPointsAllowed
      if @branchStack.length and @doubleBranchPop
        @trigger( "doubleBranch", =>
          point = @branchStack.pop()
          @stateLogger.push()
          @setActiveNode(point.id)
          @activeNode.type = @TYPE_USUAL

          @trigger("setBranch", false, @activeNode.id)
          @doubleBranchPop = true
          deferred.resolve(@activeNode.id))
      else
        point = @branchStack.pop()
        @stateLogger.push()
        if point
          @setActiveNode(point.id)
          @activeNode.type = @TYPE_USUAL

          @trigger("setBranch", false, @activeNode.id)
          @doubleBranchPop = true
          deferred.resolve(@activeNode.id)
        else
          @trigger("emptyBranchStack")
          deferred.reject()
      deferred
    else
      @trigger("noBranchPoints")
      deferred.reject()

  deleteBranch : (node) ->

    if node.type != @TYPE_BRANCH then return

    i = 0
    while i < @branchStack.length
      if @branchStack[i].id == node.id
        @branchStack.splice(i, 1)
      else
        i++
    @trigger("deleteBranch")


  rejectBranchDeferred : ->

    @branchDeferred.reject()


  resolveBranchDeferred : ->

    @branchDeferred.resolve()


  addNode : (position, type, centered = true) ->

    if @ensureDirection(position)
      unless @lastRadius?
        @lastRadius = 10 * @scaleInfo.baseVoxel
        if @activeNode? then @lastRadius = @activeNode.radius
      point = new TracePoint(type, @idCount++, position, @lastRadius, (new Date()).getTime(), @activeTree.treeId)
      @activeTree.nodes.push(point)
      if @activeNode
        @activeNode.appendNext(point)
        point.appendNext(@activeNode)
        @activeNode = point
      else
        @activeNode = point
        point.type = @TYPE_BRANCH
        if @branchPointsAllowed
          centered = true
          @pushBranch()
      @lastActiveNodeId = @activeNode.id
      @doubleBranchPop = false

      @stateLogger.createNode(point, @activeTree.treeId)
      
      @trigger("newNode", centered)
    else
      @trigger("wrongDirection")


  ensureDirection : (position) ->

    if (!@branchPointsAllowed and @activeTree.nodes.length == 2 and
        @firstEdgeDirection and @activeTree.treeId == @trees[0].treeId)
      sourceNodeNm = @scaleInfo.voxelToNm(@activeTree.nodes[1].pos)
      targetNodeNm = @scaleInfo.voxelToNm(position)
      secondEdgeDirection = [targetNodeNm[0] - sourceNodeNm[0],
                             targetNodeNm[1] - sourceNodeNm[1],
                             targetNodeNm[2] - sourceNodeNm[2]]

      return (@firstEdgeDirection[0] * secondEdgeDirection[0] +
              @firstEdgeDirection[1] * secondEdgeDirection[1] +
              @firstEdgeDirection[2] * secondEdgeDirection[2] > 0)
    else
      true


  getActiveNode : -> @activeNode


  getActiveNodeId : -> @lastActiveNodeId


  getActiveNodePos : ->

    if @activeNode then @activeNode.pos else null


  getActiveNodeType : ->

    if @activeNode then @activeNode.type else null


  getActiveNodeRadius : ->

    if @activeNode then @activeNode.radius else null


  getActiveTreeId : ->

    if @activeTree then @activeTree.treeId else null


  getActiveTreeName : ->

    if @activeTree then @activeTree.name else null


  setTreeName : (name) ->

    if @activeTree
      if name
        @activeTree.name = name
      else
        @activeTree.name = "Tree#{('00'+@activeTree.treeId).slice(-3)}"
      @stateLogger.updateTree(@activeTree)
      
      @trigger("newTreeName")


  getNode : (id) ->

    for tree in @trees
      for node in tree.nodes
        if node.id == id then return node
    return null
    

  setActiveNodeRadius : (radius) ->

    # make sure radius is within bounds
    radius = Math.min(@MAX_RADIUS * @scaleInfo.baseVoxel, radius)
    radius = Math.max(@MIN_RADIUS * @scaleInfo.baseVoxel, radius)
    if @activeNode
      @activeNode.radius = radius
      @lastRadius = radius

    @stateLogger.updateNode(@activeNode, @activeTree.treeId)

    @trigger("newActiveNodeRadius", radius)


  setActiveNode : (nodeID, mergeTree = false) ->

    lastActiveNode = @activeNode
    lastActiveTree = @activeTree
    for tree in @trees
      for node in tree.nodes
        if node.id == nodeID
          @activeNode = node
          @lastActiveNodeId = @activeNode.id
          @activeTree = tree
          break
    @stateLogger.push()

    @trigger("newActiveNode")

    if mergeTree
      @mergeTree(lastActiveNode, lastActiveTree)


  setComment : (commentText) ->

    if(@activeNode?)
      # remove any existing comments for that node
      for i in [0...@comments.length]
        if(@comments[i].node.id == @activeNode.id)
          @comments.splice(i, 1)
          @deletedCommentIndex = i
          break
      if commentText != ""
        @comments.push({node: @activeNode, content: commentText})
      @stateLogger.push()
      @trigger("updateComments")


  getComment : (nodeID) ->

    unless nodeID? then nodeID = @activeNode.id if @activeNode?
    for comment in @comments
      if comment.node.id == nodeID then return comment.content
    return ""


  deleteComment : (nodeID) ->

    for i in [0...@comments.length]
      if(@comments[i].node.id == nodeID)
        @comments.splice(i, 1)
        @stateLogger.push()
        @trigger("updateComments")
        break


  nextCommentNodeID : (forward) ->

    length = @comments.length
    offset = if forward then 1 else -1

    unless @activeNode?
      if length > 0 then return @comments[0].node.id

    if length == 0
      return null

    for i in [0...@comments.length]
      if @comments[i].node.id == @activeNode.id
        return @comments[(length + i + offset) % length].node.id

    if @deletedCommentIndex?
      offset = if forward then 0 else -1
      return @comments[(length + @deletedCommentIndex + offset) % length].node.id

    return @comments[0].node.id


  getComments : =>

    @comments.sort(@compareNodes)


  getPlainComments : =>

    plainComments = []
    for comment in @comments
      plainComments.push({node: comment.node.id, content: comment.content})
    plainComments


  selectNextTree : (forward) ->

    for i in [0...@trees.length]
      if @activeTree.treeId == @trees[i].treeId
        break

    diff = (if forward then 1 else -1) + @trees.length
    @setActiveTree( @trees[ (i + diff) % @trees.length ].treeId )


  setActiveTree : (id) ->

    for tree in @trees
      if tree.treeId == id
        @activeTree = tree
        break
    if @activeTree.nodes.length == 0
      @activeNode = null
    else
      @activeNode = @activeTree.nodes[0]
      @lastActiveNodeId = @activeNode.id
    @stateLogger.push()

    @trigger("newActiveNode")
    @trigger("newActiveTree")


  getNewTreeColor : (treeId) ->

    # this generates the most distinct colors possible, using the golden ratio
    if treeId == 1
      return 0xFF0000
    else
      currentHue = treeId * @GOLDEN_RATIO
      currentHue %= 1
      ColorConverter.setHSV(new THREE.Color(), currentHue, 1, 1).getHex()


  shuffleActiveTreeColor : ->

    oldTreeId = @activeTree.treeId
    @activeTree.treeId = @treeIdCount++
    @activeTree.color = @getNewTreeColor(@activeTree.treeId)

    # update tree ids
    for node in @activeTree.nodes
      node.treeId = @activeTree.treeId

    @stateLogger.updateTree(@activeTree, oldTreeId)

    @trigger("newActiveTree")
    @trigger("newActiveTreeColor", oldTreeId)


  createNewTree : ->

    tree = new TraceTree(
      @treeIdCount++, 
      @getNewTreeColor(@treeIdCount-1), 
      "Tree#{('00'+(@treeIdCount-1)).slice(-3)}")
    @trees.push(tree)
    @activeTree = tree
    @activeNode = null

    @stateLogger.createTree(tree)

    @trigger("newTree", tree.treeId, tree.color)


  deleteActiveNode : ->

    unless @activeNode?
      return
    # don't delete nodes when the previous tree split isn't finished
    unless @finishedDeferred.state() == "resolved"
      return

    @deleteComment(@activeNode.id)
    for neighbor in @activeNode.neighbors
      neighbor.removeNeighbor(@activeNode.id)
    @activeTree.removeNode(@activeNode.id)

    deletedNode = @activeNode
    @stateLogger.deleteNode(deletedNode, @activeTree.treeId)

    @deleteBranch(deletedNode)
    
    if deletedNode.neighbors.length > 1
      # Need to split tree
      newTrees = []
      @trigger("removeSpheresOfTree", @activeTree.nodes.concat(deletedNode))
      oldActiveTreeId = @activeTree.treeId

      for i in [0...@activeNode.neighbors.length]
        unless i == 0
          # create new tree for all neighbors, except the first
          @createNewTree()

        @activeTree.nodes = []
        @getNodeListForRoot(@activeTree.nodes, deletedNode.neighbors[i])
        # update tree ids
        unless i == 0
          for node in @activeTree.nodes
            node.treeId = @activeTree.treeId
        @setActiveNode(deletedNode.neighbors[i].id)
        newTrees.push(@activeTree)

        if @activeTree.treeId != oldActiveTreeId
          nodeIds = []
          for node in @activeTree.nodes
            nodeIds.push(node.id)
          @stateLogger.moveTreeComponent(oldActiveTreeId, @activeTree.treeId, nodeIds)

      # this deferred will be resolved once the skeleton has finished reloading the trees
      @finishedDeferred = new $.Deferred()
      @trigger("reloadTrees", newTrees, @finishedDeferred)
        
    else if @activeNode.neighbors.length == 1
      # no children, so just remove it.
      @setActiveNode(deletedNode.neighbors[0].id)
      @trigger("deleteActiveNode", deletedNode, @activeTree.treeId)
    else
      @deleteTree(false)


  deleteTree : (notify, id, deleteBranchesAndComments) ->

    unless @activeNode?
      return

    if notify
      if confirm("Do you really want to delete the whole tree?")
        @reallyDeleteTree(id, deleteBranchesAndComments)
      else
        return
    else
      @reallyDeleteTree(id, deleteBranchesAndComments)


  reallyDeleteTree : (id, deleteBranchesAndComments = true) ->

    unless id
      id = @activeTree.treeId
    tree = @getTree(id)

    for i in [0..@trees.length]
      if @trees[i].treeId == tree.treeId
        index = i
        break
    @trees.splice(index, 1)
    # remove branchpoints and comments, NOT when merging trees
    for node in tree.nodes
      if deleteBranchesAndComments
        @deleteComment(node.id)
        @deleteBranch(node)
    # Because we always want an active tree, check if we need
    # to create one.
    if @trees.length == 0
      @createNewTree()
    else
      # just set the last tree to be the active one
      @setActiveTree(@trees[@trees.length - 1].treeId)
    @stateLogger.deleteTree(tree)

    @trigger("deleteTree", index)


  mergeTree : (lastNode, lastTree) ->

    activeNodeID = @activeNode.id
    if lastNode.id != activeNodeID
      if lastTree.treeId != @activeTree.treeId
        @activeTree.nodes = @activeTree.nodes.concat(lastTree.nodes)
        @activeNode.appendNext(lastNode)
        lastNode.appendNext(@activeNode)

        # update tree ids
        for node in @activeTree.nodes
          node.treeId = @activeTree.treeId
        
        @stateLogger.mergeTree(lastTree, @activeTree, lastNode.id, activeNodeID)

        @trigger("mergeTree", lastTree.treeId, lastNode, @activeNode)

        @deleteTree(false, lastTree.treeId, false)

        @setActiveNode(activeNodeID)
      else
        @trigger("mergeDifferentTrees")


  getTree : (id) ->

    unless id
      return @activeTree
    for tree in @trees
      if tree.treeId == id
        return tree
    return null


  getTrees : -> @trees


  # returns a list of nodes that are connected to the parent
  #
  # ASSUMPTION:    we are dealing with a tree, circles would
  #                break this algorithm
  getNodeListForRoot : (result, root, previous) ->

    result.push(root)
    next = root.getNext(previous)
    while next?
      if _.isArray(next)
        for neighbor in next
          @getNodeListForRoot(result, neighbor, root)
        return
      else
        result.push(next)
        newNext = next.getNext(root)
        root = next
        next = newNext


  getNodeListOfAllTrees : ->

    result = []
    for tree in @trees
      result = result.concat(tree.nodes)
    return result


  rendered : -> @trigger("finishedRender")


  # Helper method used in initialization
  findNodeInList : (list, id) ->

    for node in list
      if node.id == id
        return node
    return null

  compareNames : (a, b) ->

    if a.name < b.name
      return -1
    if a.name > b.name
      return 1
    return 0


  compareNodes : (a, b) ->

    if a.node.treeId < b.node.treeId
      return -1
    if a.node.treeId > b.node.treeId
      return 1
    return a.node.id - b.node.id
