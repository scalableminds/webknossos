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

class TracingParser


  constructor : (@celltracing, @data) ->

    @idCount = 1
    @treeIdCount = 1
    @trees = []
    @comments = []
    @activeNode = null
    @activeTree = null


  buildTrees : ->

    for treeData in @data.trees
      # Create new tree
      tree = new TraceTree(
        treeData.id,
        @celltracing.getNewTreeColor(treeData.id),
        if treeData.name then treeData.name else "Tree#{('00'+treeData.id).slice(-3)}",
        treeData.timestamp)
      
      # Initialize nodes
      for node in treeData.nodes
        tree.nodes.push(new TracePoint(@celltracing.TYPE_USUAL, node.id, node.position, node.radius, node.timestamp, treeData.id))
        # idCount should be bigger than any other id
        @idCount = Math.max(node.id + 1, @idCount);
      
      # Initialize edges
      for edge in treeData.edges
        sourceNode = @celltracing.findNodeInList(tree.nodes, edge.source)
        targetNode = @celltracing.findNodeInList(tree.nodes, edge.target)
        if sourceNode and targetNode
          sourceNode.appendNext(targetNode)
          targetNode.appendNext(sourceNode)
        else
          $.assertNotEquals(sourceNode, null, "source node undefined",
            {"edge" : edge})
          $.assertNotEquals(targetNode, null, "target node undefined",
            {"edge" : edge})

      # Set active Node
      activeNodeT = @celltracing.findNodeInList(tree.nodes, @data.activeNode)
      if activeNodeT
        @activeNode = activeNodeT
        # Active Tree is the one last added
        @activeTree = tree

      @treeIdCount = Math.max(tree.treeId + 1, @treeIdCount)
      @trees.push(tree)


  setBranchpoints : (nodeList) ->

    for branchpoint in @data.branchPoints
      node = @celltracing.findNodeInList(nodeList, branchpoint.id)
      if node
        node.type = @celltracing.TYPE_BRANCH
        @celltracing.branchStack.push(node)


  setComments : (nodeList) ->

    for comment in @data.comments
      comment.node = @celltracing.findNodeInList(nodeList, comment.node)
    @comments = @data.comments
  

  parse : ->

    @buildTrees()
    
    nodeList = @celltracing.getNodeListOfAllTrees()

    @setBranchpoints(nodeList)
    @setComments(nodeList)

    return {
      @idCount
      @treeIdCount
      @trees
      @comments
      @activeNode
      @activeTree
    }