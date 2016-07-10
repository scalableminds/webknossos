app                        = require("app")
Backbone                   = require("backbone")
_                          = require("lodash")
Utils                      = require("libs/utils")
backbone                   = require("backbone")
Request                    = require("libs/request")
ColorGenerator             = require("libs/color_generator")
TracePoint                 = require("./tracepoint")
TraceTree                  = require("./tracetree")
SkeletonTracingStateLogger = require("./skeletontracing_statelogger")
constants                  = require("../../constants")
RestrictionHandler         = require("../helpers/restriction_handler")
TracingParser              = require("./tracingparser")

class SkeletonTracing

  # Max and min radius in base voxels (see scaleInfo.baseVoxel)
  MIN_RADIUS : 1
  MAX_RADIUS : 5000

  trees : []
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
      @addNode(tracing.content.editPosition, tracing.content.editRotation, 0, 0, 4, false)

    @branchPointsAllowed = tracing.content.settings.branchPointsAllowed
    if not @branchPointsAllowed
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
        point = new TracePoint(@idCount++, pos, Math.random() * 200, @activeTree.treeId, null, [0, 0, 0])
        @activeTree.nodes.push(point)
        if @activeNode
          @activeNode.appendNext(point)
          point.appendNext(@activeNode)
          @activeNode = point
        else
          @activeNode = point
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
        @activeTree.branchpoints.push( { id : @activeNode.id, timestamp : Date.now() } )
        @stateLogger.updateTree(@activeTree)

        @trigger("setBranch", true, @activeNode)
    else
      @trigger("noBranchPoints")


  popBranch : ->

    return if @restrictionHandler.handleUpdate()

    reallyPopBranch = (point, tree, resolve) =>
      tree.removeBranchWithNodeId(point.id)
      @stateLogger.updateTree(tree)
      @setActiveNode(point.id)

      @trigger("setBranch", false, @activeNode)
      @doubleBranchPop = true
      resolve(@activeNode.id)

    return new Promise (resolve, reject) =>
      if @branchPointsAllowed
        [point, tree] = @getNextBranch()
        if point
          if @doubleBranchPop
            @trigger("doubleBranch", => reallyPopBranch(point, tree, resolve) )
          else
            reallyPopBranch(point, tree, resolve)
        else
          @trigger("emptyBranchStack")
          reject()
      else
        @trigger("noBranchPoints")
        reject()


  getNextBranch : ->

    curTime = 0
    curPoint = null
    curTree = null

    for tree in @trees
      for branch in tree.branchpoints
        if branch.timestamp > curTime
          curTime = branch.timestamp
          curPoint = branch
          curTree = tree

    return [curPoint, curTree]


  addNode : (position, rotation, viewport, resolution, bitDepth, interpolation) ->

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

      point = new TracePoint(@idCount++, position, radius, @activeTree.treeId, metaInfo, rotation)
      @activeTree.nodes.push(point)

      if @activeNode

        @activeNode.appendNext(point)
        point.appendNext(@activeNode)
        @activeNode = point

      else

        @activeNode = point
        # first node should be a branchpoint
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


  getActiveNodeRadius : ->

    if @activeNode then @activeNode.radius else 10 * app.scaleInfo.baseVoxel


  getActiveNodeRotation : ->

    if @activeNode then @activeNode.rotation else null


  getActiveTree : ->

    if @activeTree then @activeTree else null


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

    return if @restrictionHandler.handleUpdate()

    tree = @activeTree unless tree
    tree.color = @getNewTreeColor()

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

    for neighbor in @activeNode.neighbors
      neighbor.removeNeighbor(@activeNode.id)
    updateTree = @activeTree.removeNode(@activeNode.id)

    @stateLogger.updateTree(@activeTree) if updateTree

    deletedNode = @activeNode
    @stateLogger.deleteNode(deletedNode, @activeTree.treeId)

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


  deleteTree : (notify, id, notifyServer) ->

    return if @restrictionHandler.handleUpdate()

    if notify
      if confirm("Do you really want to delete the whole tree?")
        @reallyDeleteTree(id, notifyServer)
      else
        return
    else
      @reallyDeleteTree(id, notifyServer)


  reallyDeleteTree : (id, notifyServer = true) ->

    return if @restrictionHandler.handleUpdate()

    unless id
      id = @activeTree.treeId
    tree = @getTree(id)

    for i in [0..@trees.length]
      if @trees[i].treeId == tree.treeId
        index = i
        break
    @trees.splice(index, 1)

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
        @activeTree.comments = @activeTree.comments.concat(lastTree.comments)
        @activeTree.branchpoints = @activeTree.branchpoints.concat(lastTree.branchpoints)
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


  updateTree : (tree) ->

    @stateLogger.updateTree(tree)


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
      return @getTreesSortedBy("name")
    else
      return @getTreesSortedBy("timestamp")


  getTreesSortedBy : (key, isSortedAscending) ->

    return (@trees.slice(0)).sort(Utils.compareBy(key, isSortedAscending))


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


  compareNodes : (a, b) ->

    if a.node.treeId < b.node.treeId
      return -1
    if a.node.treeId > b.node.treeId
      return 1
    return a.node.id - b.node.id


module.exports = SkeletonTracing
