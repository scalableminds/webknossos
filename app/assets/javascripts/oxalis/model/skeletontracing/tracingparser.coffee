### define
jquery : $
underscore : _
three.color : ColorConverter
libs/request : Request
libs/event_mixin : EventMixin
./tracepoint : TracePoint
./tracetree : TraceTree
../../constants : constants
###

class TracingParser


  constructor : (@skeletonTracing, @data) ->

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
        new THREE.Color().setRGB(treeData.color...).getHex(),
        if treeData.name then treeData.name else "Tree#{('00'+treeData.id).slice(-3)}",
        treeData.timestamp)

      # Initialize nodes
      for node in treeData.nodes

        metaInfo = _.pick( node,
          'timestamp', 'viewport', 'resolution', 'bitDepth', 'interpolation' )

        tree.nodes.push(
          new TracePoint(
            @skeletonTracing.TYPE_USUAL,
            node.id, node.position, node.radius, treeData.id,
            metaInfo, node.rotation))

        # idCount should be bigger than any other id
        @idCount = Math.max(node.id + 1, @idCount);

      # Initialize edges
      for edge in treeData.edges
        sourceNode = @skeletonTracing.findNodeInList(tree.nodes, edge.source)
        targetNode = @skeletonTracing.findNodeInList(tree.nodes, edge.target)
        if sourceNode and targetNode
          sourceNode.appendNext(targetNode)
          targetNode.appendNext(sourceNode)
        else
          $.assertExists(sourceNode, "source node is null", {"edge" : edge})
          $.assertExists(targetNode, "target node is null", {"edge" : edge})

      # Set active Node
      activeNodeT = @skeletonTracing.findNodeInList(tree.nodes, @data.activeNode)
      if activeNodeT
        @activeNode = activeNodeT
        # Active Tree is the one last added
        @activeTree = tree

      @treeIdCount = Math.max(tree.treeId + 1, @treeIdCount)
      @trees.push(tree)


  setBranchpoints : (nodeList) ->

    for branchpoint in @data.branchPoints
      node = @skeletonTracing.findNodeInList(nodeList, branchpoint.id)
      if node
        node.type = @skeletonTracing.TYPE_BRANCH
        @skeletonTracing.branchStack.push(node)


  setComments : (nodeList) ->

    for comment in @data.comments
      comment.node = @skeletonTracing.findNodeInList(nodeList, comment.node)
    @comments = @data.comments


  parse : ->

    unless @data?
      return {
        idCount : 0
        treeIdCount : 0
        trees : []
        comments : []
        activeNode : null
        activeTree : null
      }

    @buildTrees()

    nodeList = []
    for tree in @trees
      nodeList = nodeList.concat(tree.nodes)

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
