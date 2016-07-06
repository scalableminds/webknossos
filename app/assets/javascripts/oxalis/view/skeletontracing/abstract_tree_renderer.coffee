_         = require("lodash")
Backbone  = require("backbone")
app       = require("app")
Constants = require("oxalis/constants")
Toast     = require("libs/toast")


class AbstractTreeRenderer

  NODE_RADIUS          : 2
  MAX_NODE_DISTANCE    : 100
  CLICK_TRESHOLD       : 6

  MODE_NORMAL          : 0     # draw every node and the complete tree
  MODE_NOCHAIN         : 1     # draw only decision points

  RENDER_COMMENTS      : true  # draw comments into tree

  constructor : ($canvas) ->

    _.extend(this, Backbone.Events)

    @canvas = $canvas
    @ctx = $canvas[0].getContext("2d")
    @ctx.lineWidth = 1
    @nodeList = []


  ###*
   * Render function called by events and GUI.
   * Draws the abstract tree, emphasizes the active node
   * and highlights comments, if enabled.
   * @param  {TraceTree} tree
   * @param  {Number} @activeNodeId TracePoint id
  ###
  drawTree : (@tree, @activeNodeId) ->

    tree = @tree
    unless tree?
      return

    @setDimensions(@canvas.width(), @canvas.height())
    @clearBackground()
    @setupColors()

    # List of {x : ..., y : ..., id: ...} objects
    @nodeList = []

    # set global mode
    mode = @MODE_NOCHAIN

    # TODO: Actually, I though that buildTree() is pretty heavy, but
    # I do not experience performance issues, even with large trees.
    # Still, this might not need to be done on every single draw...
    try
      root = tree.buildTree()
    catch e
      console.log "Error:", e
      if e == "CyclicTree"
        if not @_cyclicTreeWarningIssued
          Toast.error "Cyclic trees (Tree-ID: #{tree.treeId}) are not supported by webKnossos. Please check the .nml file."
          @_cyclicTreeWarningIssued = true
        return

    unless root?
      return

    @nodeDistance = Math.min(@canvas.height() / (@getMaxTreeDepth(root, mode) + 1), @MAX_NODE_DISTANCE)

    # The algorithm works as follows:
    # A tree is given a left and right border that it can use. If
    # there is a branchpoint, both children are rest trees, so the
    # branch point will choose a left and right border for each of
    # them and call the method recursively.
    # For that decision, the branch points needs information about
    # the rest tree's width. A trees width, however, depends on its
    # children's width. So, we need to do two iterations: first we
    # determine the widths of each relevant node, then we use this
    # information to actually draw the tree. The first task is done
    # by recordWidths(), the second by drawTreeWithWidths().

    @recordWidths(root)
    @drawTreeWithWidths(root, @NODE_RADIUS, @canvas.width() - @NODE_RADIUS, @nodeDistance / 2, mode)

    # because of z layering all nodes have to be drawn last
    @drawAllNodes()


  ###*
   * Draws a whole tree inside the given borders.
   * Thus it fits on the canvas and scales as the tree grows.
   * @param  {TracePoint} tree
   * @param  {Number} left  left border in pixels
   * @param  {Number} right right border in pixels
   * @param  {Number} top   y coordinate in pixels
   * @param  {Number} mode  @MODE_NORMAL or @MODE_NOCHAIN
   * @return {Object}       new middle and top coordinates in pixels
  ###
  drawTreeWithWidths : (tree, left, right, top, mode) ->

    decision = @getNextDecision(tree)
    middle = @calculateMiddle(left, right)

    if decision.isBranch
      middle = @drawBranch(decision, left, right, top, mode)
    else if !decision.isLeaf
      middle = @drawCommentChain(decision, left, right, top, mode)

    if mode == @MODE_NORMAL or decision.chainCount < 3
      @drawChainFromTo(top, middle, tree, decision)
    else if mode == @MODE_NOCHAIN
      @drawChainWithChainIndicatorFromTo(top, middle, tree, decision)

    return { middle, top }


  ###*
   * Find the next node which have to be considered in an extra way.
   * These are:
   *   - branch points
   *   - leaves
   *   - commented nodes
   * @param  {TracePoint} tree
   * @return {Decision}
  ###
  getNextDecision : (tree) ->

    chainCount = 0
    hasActiveNode = false

    # skip comment check on first node
    if tree.children.length == 1
        tree = tree.children[0]
        chainCount++

    while tree.children.length == 1 and !@nodeIdHasComment(tree.id)
      if !hasActiveNode
          hasActiveNode = tree.id == @activeNodeId
      tree = tree.children[0]
      chainCount++

    return {
      node: tree,
      chainCount,
      isBranch: tree.children.length > 1
      isLeaf: tree.children.length == 0
      hasActiveNode: hasActiveNode
    }


  ###*
   * Draw a branch point as well as the left and right subtree.
   * @param  {Decision} decision
   * @param  {Number} left     left border in pixels
   * @param  {Number} right    right border in pixels
   * @param  {Number} top      y coordinate in pixels
   * @param  {Number} mode     @MODE_NORMAL or @MODE_NOCHAIN
   * @return {Number}          new middle coordinate in pixels
  ###
  drawBranch : (decision, left, right, top, mode) ->

    branchMiddle = @calculateBranchMiddle(decision, left, right)
    topChildren = @calculateChildTop(decision.chainCount, top, mode)
    leftTree = @drawTreeWithWidths(decision.node.children[0], left,  branchMiddle, topChildren, mode)
    rightTree = @drawTreeWithWidths(decision.node.children[1], branchMiddle, right, topChildren, mode)

    # set the root's x coordinate to be in between the decisionPoint's children
    middle = @calculateMiddle(leftTree.middle, rightTree.middle)

    # draw edges from last node in 'chain' (or root, if chain empty)
    # and the decisionPoint's children
    @drawEdge(middle, topChildren - @nodeDistance, leftTree.middle, leftTree.top)
    @drawEdge(middle, topChildren - @nodeDistance, rightTree.middle, rightTree.top)

    return middle


  ###*
   * Draw a sequence of nodes which begins with a comment.
   * @param  {Decision}        decision
   * @param  {Number} left     left border in pixels
   * @param  {Number} right    right border in pixels
   * @param  {Number} top      y coordinate in pixels
   * @param  {Number} mode     @MODE_NORMAL or @MODE_NOCHAIN
   * @return {Number}          new middle coordinate in pixels
  ###
  drawCommentChain : (decision, left, right, top, mode) ->

    topChild = @calculateTop(decision.chainCount, top, mode)
    extent = @drawTreeWithWidths(decision.node, left, right, topChild, mode)
    return extent.middle


  ###*
   * Draws a sequence of nodes and the edges in between.
   * @param  {Number} top      y coordinate in pixels
   * @param  {Number} left     x coordinate in pixels
   * @param  {TracePoint} tree
   * @param  {Decision} decision
  ###
  drawChainFromTo : (top, left, tree, decision) ->

    # Draw the chain and the tree, connect them.
    node = tree
    for i in [0..decision.chainCount]
      @addNode(left, top + i * @nodeDistance, node.id)
      node = node.children[0]
      if i != 0
        @drawEdge(left, top + (i - 1) * @nodeDistance, left, top + i * @nodeDistance)


  ###*
   * Draws the dashed chain indicator and the start and end nodes.
   * @param  {Number} top      y coordinate in pixels
   * @param  {Number} middle   middel x coordinate in pixels
   * @param  {TracePoint} tree
   * @param  {Decision} decision
  ###
  drawChainWithChainIndicatorFromTo : (top, middle, tree, decision) ->

    @addNode(middle, top, tree.id)
    @drawEdge(middle, top, middle, top + 0.5 * @nodeDistance)
    @drawChainIndicator(middle, top + 0.5 * @nodeDistance, top + 1.5 * @nodeDistance, decision.hasActiveNode)
    @drawEdge(middle, top + 1.5 * @nodeDistance, middle, top + 2 * @nodeDistance)
    @addNode(middle, top + 2 * @nodeDistance, decision.node.id)


  ###*
   * Calculate middle that divides the left and right tree, if any.
   * Middle is weighted accordingly to the subtrees` widths.
   * @param  {Decision} decision
   * @param  {Number} left           left border in pixels
   * @param  {Number} right          right border in pixels
   * @return {Number}                middle in pixels
  ###
  calculateBranchMiddle : (decision, left, right) ->

    leftChild = decision.node.children[0]
    rightChild = decision.node.children[1]
    return (right - left) * leftChild.width / (leftChild.width + rightChild.width) + left


  ###*
   * Calculate middle of a left and right border.
   * @param  {Number} left  left border in pixels
   * @param  {Number} right right border in pixels
   * @return {Number}       middle in pixels
  ###
  calculateMiddle : (left, right) ->

    return (left + right) / 2


  ###*
   * Calculate the y coordinate of a node.
   * @param  {Number} chainCount amount of chained nodes since the parent node
   * @param  {Number} top        y coordinate of the parent node
   * @param  {Number} mode       @MODE_NORMAL or @MODE_NOCHAIN
   * @return {Number}            y coordinate of the current decision node
  ###
  calculateTop : (chainCount, top, mode) ->

    if mode == @MODE_NORMAL or chainCount < 3
      return top + chainCount * @nodeDistance
    else if mode == @MODE_NOCHAIN
      return top + 2 * @nodeDistance


  ###*
   * Calculate the y coordinate of the first child of a node.
   * @param  {Number} chainCount amount of chained nodes since the parent node
   * @param  {Number} top        y coordinate of the parent node
   * @param  {Number} mode       @MODE_NORMAL or @MODE_NOCHAIN
   * @return {Number}            y coordinate of the current decision node's child
  ###
  calculateChildTop : (chainCount, top, mode) ->

    return @calculateTop(chainCount, top, mode) + @nodeDistance


  ###*
   * Add a node to the node list, so it can be drawn later.
   * @param {Number} x
   * @param {Number} y
   * @param {Number} id TracePoint id
  ###
  addNode : (x, y, id) ->

    @nodeList.push({x : x, y : y, id : id})


  ###*
   * Iterate the node list and draw all nodes onto the canvas.
  ###
  drawAllNodes : ->

    for {x, y, id} in @nodeList
      @drawNode(x, y, id)


  ###*
   * Draw a single node onto the canvas.
   * Take active state, theme and comment into consideration.
   * @param  {Number} x
   * @param  {Number} y
   * @param  {Number} id TracePoint id
  ###
  drawNode : (x, y, id) ->

    @ctx.beginPath()

    @ctx.fillStyle = @vgColor
    if @nodeIdHasComment(id)
      @ctx.fillStyle = @commentColor

    radius = @NODE_RADIUS
    if id == @activeNodeId
      radius = 2 * radius

    @ctx.arc(x, y, radius, 0, 2 * Math.PI)
    @ctx.fill()


  ###*
   * Draw an edge of the tree (a connector line) onto the canvas.
   * Take theme into consideration.
   * @param  {Number} x1 start coordinate
   * @param  {Number} y1
   * @param  {Number} x2 end coordinate
   * @param  {Number} y2
  ###
  drawEdge : (x1, y1, x2, y2) ->

    @ctx.beginPath()
    @ctx.strokeStyle = @vgColor
    @ctx.moveTo(x1, y1)
    @ctx.lineTo(x2, y2)
    @ctx.stroke()


  ###*
   * Draw a dashed edge, which indicates a straight chain of nodes.
   * Take active state and theme into consideration.
   * @param  {Number} x
   * @param  {Number} top         start y coordinate
   * @param  {Number} bottom      end y coordinate
   * @param  {Boolean} emphasize  draw in bold outline when active node is in the chain
  ###
  drawChainIndicator : (x, top, bottom, emphasize = false) ->

    dashLength = (bottom - top) / 7
    if emphasize
      @ctx.lineWidth = 4
    @ctx.beginPath()
    @ctx.strokeStyle = @vgColor
    for i in [0, 1, 2]
      @ctx.moveTo(x, top + (2 * i + 1) * dashLength)
      @ctx.lineTo(x, top + (2 * i + 2) * dashLength)
    @ctx.stroke()
    @ctx.lineWidth = 1


  ###*
   * Checks if a node is commented (RENDER_COMMENTS has to be true).
   * @param  {Number} id TracePoint id
   * @return {Boolean}    true if node is commented
  ###
  nodeIdHasComment : (id) ->

    return @RENDER_COMMENTS and _.find(@tree.comments, { node : id })


  ###*
   * Traverse the tree and add a width property for each node
   * which indicates the number of all leaves in the tree.
   * @param  {TracePoint}   tree
   * @return {Number}       width of the tree
  ###
  recordWidths : (tree) ->

    # Because any node with children.length == 1 has
    # the same width as its child, we can skip those.

    decision = @getNextDecision(tree)

    # Leaves just have a width of one
    if decision.isLeaf
      decision.node.width = 1
      return 1

    # Branchpoints are as wide as its children combined.
    # But actually, we need the width of the children
    # edge case: system is made for binary trees only
    width = 0
    for child in decision.node.children[0...2]
      child.width = @recordWidths(child)
      width += child.width

    return width


  ###*
   * Recursively calculate the maximum depth of a TracePoint tree.
   * @param  {TracePoint} tree
   * @param  {Number} mode      @MODE_NORMAL or @MODE_NOCHAIN
   * @param  {Number} count     helper count, current depth
   * @return {Number}           depth of the tree
  ###
  getMaxTreeDepth : (tree, mode = @MODE_NORMAL, count = 0) ->

    unless tree
      return count

    # current tree is a decision point
    count++

    # find next decision point
    decision = @getNextDecision(tree)
    if mode == @MODE_NOCHAIN
      decision.chainCount = Math.min(decision.chainCount, 2)
    count += decision.chainCount

    # bottom reached, done.
    if decision.isLeaf
      return count

    # traverse further and compare left & right subtree
    if decision.isBranch
      return Math.max(
              @getMaxTreeDepth(decision.node.children[0], mode, count),
              @getMaxTreeDepth(decision.node.children[1], mode, count)
             )

    # current decision point is a comment, follow the current chain
    return @getMaxTreeDepth(decision.node.children[0], mode, count)


  ###*
   * Get the id of a TracePoint from a position on the canvas.
   * @param  {Number} x
   * @param  {Number} y
   * @return {Number}   TracePoint id
  ###
  getIdFromPos : (x, y) =>

    for entry in @nodeList
      if Math.abs(x - entry.x) <= @CLICK_TRESHOLD &&
          Math.abs(y - entry.y) <= @CLICK_TRESHOLD
        return entry.id


  ###*
   * Clear the background of the canvas.
  ###
  clearBackground : ->

    @ctx.clearRect(0, 0, @canvas.width(), @canvas.height())


  ###*
   * Apply a color theme according to the overall oxalis theme for
   *  - comments
   *  - nodes & edges
  ###
  setupColors : ->

    # apply color scheme
    if app.oxalis.view.theme == Constants.THEME_BRIGHT
      @vgColor = "black"
      @commentColor = "red"
    else
      @vgColor = "white"
      @commentColor = "blue"


  ###*
   * Setter.
   * @param  {Boolean} renderComments true, if abstract tree should show comments
  ###
  renderComments : (renderComments) ->

    @RENDER_COMMENTS = renderComments


  ###*
   * Set width and height of the canvas object.
   * @param {Number} width
   * @param {Number} height
  ###
  setDimensions : (width, height) ->

    @canvas[0].width = width
    @canvas[0].height = height


module.exports = AbstractTreeRenderer
