_                  = require("lodash")
THREE              = require("three")
TracePoint         = require("./tracepoint")
TraceTree          = require("./tracetree")
Toast              = require("libs/toast")
CommentsCollection = require("oxalis/model/right-menu/comments_collection")

class TracingParser


  constructor : (@skeletonTracing, @data) ->

    @idCount = 1
    @treeIdCount = 1
    @trees = []
    @comments = new CommentsCollection()
    @activeNode = null
    @activeTree = null


  buildTrees : ->

    for treeData in @data.trees
      # Create new tree
      tree = new TraceTree(
        treeData.id,
        @convertColor(treeData.color),
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
            metaInfo))

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
          Toast.error("Node with id #{edge.source} doesn't exist. Ignored edge due to missing source node.") if not sourceNode
          Toast.error("Node with id #{edge.target} doesn't exist. Ignored edge due to missing target node.") if not targetNode

      # Set active Node
      activeNodeT = @skeletonTracing.findNodeInList(tree.nodes, @data.activeNode)
      if activeNodeT
        @activeNode = activeNodeT
        # Active Tree is the one last added
        @activeTree = tree

      @treeIdCount = Math.max(tree.treeId + 1, @treeIdCount)
      @trees.push(tree)

    if @data.activeNode and not @activeNode
      Toast.error("Node with id #{@data.activeNode} doesn't exist. Ignored active node.")


  convertColor : (colorArray) ->

    if colorArray?
      return new THREE.Color().setRGB(colorArray...).getHex()

    return null


  setBranchpoints : (nodeList) ->

    for branchpoint in @data.branchPoints
      node = @skeletonTracing.findNodeInList(nodeList, branchpoint.id)
      if node
        node.type = @skeletonTracing.TYPE_BRANCH
        @skeletonTracing.branchStack.push(node)
      else
        Toast.error("Node with id #{branchpoint.id} doesn't exist. Ignored branchpoint.")


  setComments : (nodeList) ->

    filteredComments = _.filter(@data.comments, (comment) ->
      _.some(nodeList, (node) -> node.id == comment.node)
    )
    @comments.add(filteredComments)


  parse : ->

    unless @data?
      return {
        idCount : 0
        treeIdCount : 0
        trees : []
        comments : new CommentsCollection()
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

module.exports = TracingParser
