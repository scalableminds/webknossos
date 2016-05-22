app                        = require("app")
Backbone                   = require("backbone")
_                          = require("lodash")
backbone                   = require("backbone")
Request                    = require("libs/request")
ColorGenerator             = require("libs/color_generator")
TracePoint                 = require("./tracepoint")
TraceTree                  = require("./tracetree")
SkeletonTracingStateLogger = require("./skeletontracing_statelogger")
constants                  = require("../../constants")
RestrictionHandler         = require("../helpers/restriction_handler")
TracingParser              = require("./tracingparser")
CommentsCollection         = require("oxalis/model/right-menu/comments_collection")

class SkeletonTracing

  TYPE_USUAL   : constants.TYPE_USUAL
  TYPE_BRANCH  : constants.TYPE_BRANCH
  # Max and min radius in base voxels (see scaleInfo.baseVoxel)
  MIN_RADIUS        : 1
  MAX_RADIUS        : 5000

  branchStack : []
  trees : []
  comments : new CommentsCollection()
  activeNode : null
  activeTree : null
  firstEdgeDirection : null

  constructor : (tracing, @flycam, @flycam3d, @user) ->

    _.extend(this, Backbone.Events)

    @doubleBranchPop = false

    @data = tracing.content.contentData
    @restrictionHandler = new RestrictionHandler(tracing.restrictions)


    ############ Load Tree from @data ##############

    @stateLogger = new SkeletonTracingStateLogger(
      @flycam, @flycam3d, tracing.version, tracing.id, tracing.typ,
      tracing.restrictions.allowUpdate, this)

    tracingParser = new TracingParser(@, @data)
    {
      @idCount
      @treeIdCount
      @trees
      @comments
      @activeNode
      @activeTree
    } = tracingParser.parse()

    # Initialize tree colors
    @colorIdCounter = @treeIdCount

    for tree in @trees
      unless tree.color?
        @shuffleTreeColor(tree)

    # ensure a tree is active
    unless @activeTree
      if @trees.length > 0
        @activeTree = @trees[0]
      else
        @createNewTree()

    tracingType = tracing.typ
    if (tracingType == "Task") and @getNodeListOfAllTrees().length == 0
      @addNode(tracing.content.editPosition, tracing.content.editRotation, @TYPE_USUAL, 0, 0, 4, false)

    @branchPointsAllowed = tracing.content.settings.branchPointsAllowed
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


    app.router.on("beforeunload", =>
      if !@stateLogger.stateSaved() and @stateLogger.allowUpdate
        @stateLogger.pushNow(false)
        return "You haven't saved your progress, please give us 2 seconds to do so and and then leave this site."
      else
        return
    )


  benchmark : (numberOfTrees = 1, numberOfNodesPerTree = 10000) ->

    console.log "[benchmark] start inserting #{numberOfNodesPerTree} nodes"
    startTime = (new Date()).getTime()
    offset = 0
    size = numberOfNodesPerTree / 10
    for i in [0...numberOfTrees]
      @createNewTree()
      for i in [0...numberOfNodesPerTree]
        pos = [Math.random() * size + offset, Math.random() * size + offset, Math.random() * size + offset]
        point = new TracePoint(@TYPE_USUAL, @idCount++, pos, Math.random() * 200, @activeTree.treeId, null, [0, 0, 0])
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
        @doubleBranchPop = false
      offset += size
    @trigger("reloadTrees")
    console.log "[benchmark] done. Took me #{((new Date()).getTime() - startTime) / 1000} seconds."


  pushBranch : ->

    return if @restrictionHandler.handleUpdate()

    if @branchPointsAllowed
      if @activeNode
        @branchStack.push(@activeNode)
        @activeNode.type = @TYPE_BRANCH
        @stateLogger.push()

        @trigger("setBranch", true, @activeNode)
    else
      @trigger("noBranchPoints")


  popBranch : ->

    return if @restrictionHandler.handleUpdate()

    return new Promise (resolve, reject) =>
      if @branchPointsAllowed
        if @branchStack.length and @doubleBranchPop
          @trigger("doubleBranch", =>
            point = @branchStack.pop()
            @stateLogger.push()
            @setActiveNode(point.id)
            @activeNode.type = @TYPE_USUAL

            @trigger("setBranch", false, @activeNode)
            @doubleBranchPop = true
            resolve(@activeNode.id))
        else
          point = @branchStack.pop()
          @stateLogger.push()
          if point
            @setActiveNode(point.id)
            @activeNode.type = @TYPE_USUAL

            @trigger("setBranch", false, @activeNode)
            @doubleBranchPop = true
            resolve(@activeNode.id)
          else
            @trigger("emptyBranchStack")
            reject()
      else
        @trigger("noBranchPoints")
        reject()


  deleteBranch : (node) ->

    return if @restrictionHandler.handleUpdate()

    if node.type != @TYPE_BRANCH then return

    i = 0
    while i < @branchStack.length
      if @branchStack[i].id == node.id
        @branchStack.splice(i, 1)
      else
        i++


  isBranchPoint : (id) ->

    return id in (node.id for node in @branchStack)


  addNode : (position, rotation, type, viewport, resolution, bitDepth, interpolation) ->

    return if @restrictionHandler.handleUpdate()

    if @ensureDirection(position)

      radius = 10 * app.scaleInfo.baseVoxel
      if @activeNode then radius = @activeNode.radius

      metaInfo =
        timestamp : (new Date()).getTime()
        viewport : viewport
        resolution : resolution
        bitDepth : bitDepth
        interpolation : interpolation

      point = new TracePoint(type, @idCount++, position, radius, @activeTree.treeId, metaInfo, rotation)
      @activeTree.nodes.push(point)

      if @activeNode

        @activeNode.appendNext(point)
        point.appendNext(@activeNode)
        @activeNode = point

      else

        @activeNode = point
        point.type = @TYPE_BRANCH
        if @branchPointsAllowed
          @pushBranch()

      @doubleBranchPop = false

      @stateLogger.createNode(point, @activeTree.treeId)

      @trigger("newNode", @activeNode.id, @activeTree.treeId)
      @trigger("newActiveNode", @activeNode.id)
    else
      @trigger("wrongDirection")


  ensureDirection : (position) ->

    if (!@branchPointsAllowed and @activeTree.nodes.length == 2 and
        @firstEdgeDirection and @activeTree.treeId == @trees[0].treeId)
      sourceNodeNm = app.scaleInfo.voxelToNm(@activeTree.nodes[1].pos)
      targetNodeNm = app.scaleInfo.voxelToNm(position)
      secondEdgeDirection = [targetNodeNm[0] - sourceNodeNm[0],
                             targetNodeNm[1] - sourceNodeNm[1],
                             targetNodeNm[2] - sourceNodeNm[2]]

      return (@firstEdgeDirection[0] * secondEdgeDirection[0] +
              @firstEdgeDirection[1] * secondEdgeDirection[1] +
              @firstEdgeDirection[2] * secondEdgeDirection[2] > 0)
    else
      true


  getActiveNode : -> @activeNode


  getActiveNodeId : ->

    if @activeNode then @activeNode.id else null


  getActiveNodePos : ->

    if @activeNode then @activeNode.pos else null


  getActiveNodeType : ->

    if @activeNode then @activeNode.type else null


  getActiveNodeRadius : ->

    if @activeNode then @activeNode.radius else 10 * app.scaleInfo.baseVoxel


  getActiveNodeRotation : ->

    if @activeNode then @activeNode.rotation else null


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

      @trigger("newTreeName", @activeTree.treeId)


  getNode : (id) ->

    for tree in @trees
      for node in tree.nodes
        if node.id == id then return node
    return null


  setActiveNode : (nodeID, mergeTree = false) ->

    lastActiveNode = @activeNode
    lastActiveTree = @activeTree
    for tree in @trees
      for node in tree.nodes
        if node.id == nodeID
          @activeNode = node
          @activeTree = tree
          break

    @stateLogger.push()
    @trigger("newActiveNode", @activeNode.id)

    if mergeTree
      @mergeTree(lastActiveNode, lastActiveTree)


  setActiveNodeRadius : (radius) ->

    return if @restrictionHandler.handleUpdate()

    if @activeNode?
      @activeNode.radius = Math.min( @MAX_RADIUS,
                            Math.max( @MIN_RADIUS, radius ) )
      @stateLogger.updateNode( @activeNode, @activeNode.treeId )
      @trigger("newActiveNodeRadius", radius)


  setComment : (commentText) ->

    return if @restrictionHandler.handleUpdate()

    if @activeNode
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

    unless nodeID? then nodeID = @activeNode.id if @activeNode
    for comment in @comments
      if comment.node.id == nodeID then return comment.content
    return ""


  deleteComment : (nodeID) ->

    return if @restrictionHandler.handleUpdate()

    for i in [0...@comments.length]
      if(@comments[i].node.id == nodeID)
        @comments.splice(i, 1)
        @stateLogger.push()
        @trigger("updateComments")
        break


  nextCommentNodeID : (forward) ->

    length = @comments.length
    offset = if forward then 1 else -1

    unless @activeNode
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


  getComments : (ascendingOrder = true) =>

    @comments.sort(@compareNodes)
    if not ascendingOrder
      return @comments.reverse()
    return @comments


  getPlainComments : =>

    plainComments = []
    for comment in @comments
      plainComments.push({node: comment.node.id, content: comment.content})
    plainComments


  selectNextTree : (forward) ->

    trees = @getTreesSorted(@user.get("sortTreesByName"))
    for i in [0...trees.length]
      if @activeTree.treeId == trees[i].treeId
        break

    diff = (if forward then 1 else -1) + trees.length
    @setActiveTree(trees[ (i + diff) % trees.length ].treeId)


  centerActiveNode : ->

    position = @getActiveNodePos()
    if position
      @flycam.setPosition(position)


  setActiveTree : (id) ->

    for tree in @trees
      if tree.treeId == id
        @activeTree = tree
        break
    if @activeTree.nodes.length == 0
      @activeNode = null
    else
      @activeNode = @activeTree.nodes[0]
      @trigger("newActiveNode", @activeNode.id)
    @stateLogger.push()

    @trigger("newActiveTree", @activeTree.treeId)


  getNewTreeColor : ->

    return ColorGenerator.distinctColorForId( @colorIdCounter++ )


  shuffleTreeColor : (tree) ->

    tree = @activeTree unless tree
    tree.color = @getNewTreeColor()

    if @restrictionHandler.handleUpdate()
      @stateLogger.updateTree(tree)

    @trigger("newTreeColor", tree.treeId)


  shuffleAllTreeColors : ->

    for tree in @trees
      @shuffleTreeColor(tree)


  createNewTree : ->

    return if @restrictionHandler.handleUpdate()

    tree = new TraceTree(
      @treeIdCount++,
      @getNewTreeColor(),
      "Tree#{('00'+(@treeIdCount-1)).slice(-3)}",
      (new Date()).getTime())
    @trees.push(tree)
    @activeTree = tree
    @activeNode = null

    @stateLogger.createTree(tree)

    @trigger("newTree", tree.treeId, tree.color)


  deleteActiveNode : ->

    return if @restrictionHandler.handleUpdate()

    unless @activeNode
      return

    @trigger("deleteComment", @activeNode.id)
    for neighbor in @activeNode.neighbors
      neighbor.removeNeighbor(@activeNode.id)
    @activeTree.removeNode(@activeNode.id)

    deletedNode = @activeNode
    @stateLogger.deleteNode(deletedNode, @activeTree.treeId)

    @deleteBranch(deletedNode)

    if deletedNode.neighbors.length > 1
      # Need to split tree
      newTrees = []
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

      @trigger("reloadTrees", newTrees)

    else if @activeNode.neighbors.length == 1
      # no children, so just remove it.
      @setActiveNode(deletedNode.neighbors[0].id)
      @trigger("deleteActiveNode", deletedNode, @activeTree.treeId)
    else
      @deleteTree(false)


  deleteTree : (notify, id, deleteBranchesAndComments, notifyServer) ->

    return if @restrictionHandler.handleUpdate()

    if notify
      if confirm("Do you really want to delete the whole tree?")
        @reallyDeleteTree(id, deleteBranchesAndComments, notifyServer)
      else
        return
    else
      @reallyDeleteTree(id, deleteBranchesAndComments, notifyServer)


  reallyDeleteTree : (id, deleteBranchesAndComments = true, notifyServer = true) ->

    return if @restrictionHandler.handleUpdate()

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
        @trigger("deleteComment", node.id)
        @deleteBranch(node)

    if notifyServer
      @stateLogger.deleteTree(tree)
    @trigger("deleteTree", index)

    # Because we always want an active tree, check if we need
    # to create one.
    if @trees.length == 0
      @createNewTree()
    else
      # just set the last tree to be the active one
      @setActiveTree(@trees[@trees.length - 1].treeId)


  mergeTree : (lastNode, lastTree) ->

    return if @restrictionHandler.handleUpdate()

    unless lastNode
      return

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

        @deleteTree(false, lastTree.treeId, false, false)

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


  getTreesSorted : ->

    if @user.get("sortTreesByName")
      return (@trees.slice(0)).sort(@compareNames)
    else
      return (@trees.slice(0)).sort(@compareTimestamps)


  getNodeListForRoot : (result, root, previous) ->
    # returns a list of nodes that are connected to the parent
    #
    # ASSUMPTION:    we are dealing with a tree, circles would
    #                break this algorithm

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


  findNodeInList : (list, id) ->
    # Helper method used in initialization

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


  compareTimestamps : (a,b) ->

    if a.timestamp < b.timestamp
      return -1
    if a.timestamp > b.timestamp
      return 1
    return 0


  compareNodes : (a, b) ->

    if a.node.treeId < b.node.treeId
      return -1
    if a.node.treeId > b.node.treeId
      return 1
    return a.node.id - b.node.id

  getPlainComments : =>

    return @comments.toJSON()


module.exports = SkeletonTracing
