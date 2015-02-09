### define
backbone : Backbone
app : app
oxalis/constants : Constants
libs/toast : Toast
###


class AbstractTreeRenderer

  NODE_RADIUS          : 2
  MAX_NODE_DISTANCE    : 100
  CLICK_TRESHOLD       : 6

  MODE_NORMAL          : 0     # draw every node and the complete tree
  MODE_NOCHAIN         : 1     # draw only decision points

  RENDER_COMMENTS      : false  # draw comments into tree

  constructor : ($canvas, width, height) ->

    _.extend(this, Backbone.Events)

    @canvas = $canvas
    @ctx = $canvas[0].getContext("2d")
    @ctx.lineWidth = 1
    @width = width
    @height = height
    @nodeList = []


  setDimensions : ({width, height}) ->

    $(@canvas).css({width, height})
    @canvas[0].width = width
    @canvas[0].height = height


  drawTree : (tree, @activeNodeId, @comments) ->

    unless tree?
      return

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
          Toast.error "Cyclic trees (Tree-ID: #{tree.treeId}) are not supported by Oxalis. Please check the .nml file."
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
    @drawTreeWithWidths(root, @NODE_RADIUS, @canvas.width() - @NODE_RADIUS, @nodeDistance, mode)


  drawTreeWithWidths : (tree, left, right, top, mode) ->

    # get the decision point
    decision = @getNextDecision(tree)
    middle = @calculateTreeMiddle(decision, left, right)
    rootX = middle # if decisionPoint is leaf, there's not much to do

    # if the decision point has 2 children, draw them and remember their position
    if decision.isBranch

      topChildren = @calculateChildTreeTop(mode, decision.chainCount, top)
      leftTree = @drawTreeWithWidths(decision.node.children[0], left,  middle, topChildren, mode)
      rightTree = @drawTreeWithWidths(decision.node.children[1], middle, right, topChildren, mode)

      # set the root's x coordinate to be in between the decisionPoint's children
      rootX = (leftTree.rootX + rightTree.rootX) / 2

      # draw edges from last node in 'chain' (or root, if chain empty)
      # and the decisionPoint's children
      @drawEdge(rootX, topChildren - @nodeDistance, leftTree.rootX, leftTree.top)
      @drawEdge(rootX, topChildren - @nodeDistance, rightTree.rootX, rightTree.top)

    else if !decision.isLeaf

      childNode = decision.node.children[0]
      topChild = @calculateChildTreeTop(mode, decision.chainCount, top)
      nodeHasComment = @nodeHasComment(decision.node.id)

      if nodeHasComment
        childNode = decision.node
        topChild -= @nodeDistance

      childTree = @drawTreeWithWidths(childNode, left, right, topChild, mode)

      if !nodeHasComment
        @drawEdge(rootX, topChild - @nodeDistance, childTree.rootX, childTree.top)


    if mode == @MODE_NORMAL or decision.chainCount < 3
      @drawChainFromTo(top, rootX, tree, decision)

    else if mode == @MODE_NOCHAIN

      hasActiveNode = @chainContainsActiveNode(tree, decision.node)

      # Draw root, chain indicator and decision point
      @drawNode(rootX, top, tree.id)
      @drawEdge(rootX, top, rootX, top + 0.5 * @nodeDistance)
      @drawChainIndicator(rootX, top + 0.5 * @nodeDistance, top + 1.5 * @nodeDistance, hasActiveNode)
      @drawEdge(rootX, top + 1.5 * @nodeDistance, rootX, top + 2 * @nodeDistance)
      @drawNode(rootX, top + 2 * @nodeDistance, decision.node.id)


    return { rootX, top }


  ###*
   * calculate m (middle that divides the left and right tree, if any)
   * @param  {Object} decision       a point which definitely has to be drawn
   * @param  {Number} left           left border in pixels
   * @param  {Number} right          right border in pixels
   * @return {Number}                middle in pixels
  ###
  calculateTreeMiddle : (decision, left, right) ->

    if decision.isBranch
      leftChild = decision.node.children[0]
      rightChild = decision.node.children[1]
      return (right - left) * leftChild.width / (leftChild.width + rightChild.width) + left

    return (left + right) / 2


  # Calculate the top of the children
  calculateChildTreeTop : (mode, chainCount, top) ->

    if mode == @MODE_NORMAL or chainCount < 3
      return top + (chainCount + 1) * @nodeDistance
    else if mode == @MODE_NOCHAIN
      return top + 3 * @nodeDistance


  clearBackground : ->

    @ctx.clearRect(0, 0, @canvas.width(), @canvas.height())


  setupColors : ->

    # apply color scheme
    if app.oxalis.view.theme == Constants.THEME_BRIGHT
      @vgColor = "black"
      @commentColor = "red"
    else
      @vgColor = "white"
      @commentColor = "blue"


  drawNode : (x, y, id) ->

    @ctx.beginPath()

    @ctx.fillStyle = @vgColor
    if @nodeHasComment(id)
      @ctx.fillStyle = @commentColor

    radius = @NODE_RADIUS
    if id == @activeNodeId
      radius = 2 * radius

    @ctx.arc(x, y, radius, 0, 2 * Math.PI)
    @ctx.fill()

    # put it in nodeList
    @nodeList.push({x : x, y : y, id : id})


  drawEdge : (x1, y1, x2, y2) ->

    @ctx.beginPath()
    @ctx.strokeStyle = @vgColor
    @ctx.moveTo(x1, y1)
    @ctx.lineTo(x2, y2)
    @ctx.stroke()


  drawChainIndicator : (x, top, bottom, emphasize = false) ->

    # Draw a dashed line
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


  drawChainFromTo : (top, left, root, decision) ->

    # Draw the chain and the root, connect them.
    node = root
    for i in [0..decision.chainCount]
      @drawNode(left, top + i * @nodeDistance, node.id)
      node = node.children[0]
      if i != 0
        @drawEdge(left, top + (i - 1) * @nodeDistance, left, top + i * @nodeDistance)


  getNextDecision : (tree) ->

    # Decision point is any point with point.children.length != 1
    # or any point that has a comment.
    # Decision points will definitely be drawn.

    chainCount = 0

    # skip comment check on first node
    if tree.children.length == 1
        tree = tree.children[0]
        chainCount++

    while tree.children.length == 1 and !@nodeHasComment(tree.id)
      tree = tree.children[0]
      chainCount++

    return {
      node: tree,
      chainCount,
      isBranch: tree.children.length > 1
      isLeaf: tree.children.length == 0
    }


  chainContainsActiveNode : (root, decisionNode) ->

      # Find out, if the chain contains an active node
      node = root.children[0]
      hasActiveNode = false

      while node.id != decisionNode.id
        if node.id == @activeNodeId
          return true
        node = node.children[0]

      return false



  recordWidths : (tree) ->

    # Because any node with children.length == 1 has
    # the same width as its child, we can skip those.

    decision = @getNextDecision(tree)

    # Leaves just have a width of one
    if decision.isLeaf
      decision.node.width = 1
      return 1

    # edge case: system is made for binary trees only
    # allow a maximum of two
    if decision.node.children.length > 2
      decision.node.children = decision.node.children[0...2]

    # Branchpoints are as wide as its children combined.
    # But actually, we need the width of the children
    width = 0
    for child in decision.node.children
      child.width = @recordWidths(child)
      width += child.width

    return width


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


  getIdFromPos : (x, y) =>

    for entry in @nodeList
      if Math.abs(x - entry.x) <= @CLICK_TRESHOLD &&
          Math.abs(y - entry.y) <= @CLICK_TRESHOLD
        return entry.id


  nodeHasComment : (id) ->

    return @RENDER_COMMENTS and @comments.hasCommentWithNodeId(id)


