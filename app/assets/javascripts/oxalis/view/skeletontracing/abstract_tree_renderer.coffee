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

    # clear Background
    @ctx.clearRect(0, 0, @canvas.width(), @canvas.height())

    # apply color scheme
    if app.oxalis.view.theme == Constants.THEME_BRIGHT
      @vgColor = "black"
      @commentColor = "red"
    else
      @vgColor = "white"
      @commentColor = "blue"

    unless tree?
      return

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
    decisionPoint = @getNextDecisionPoint(tree)

    # TODO: algorithm expects all decision points to be branch points
    # though a normal point with comment only has one child --> refactor this

    middle = @calculateTreeMiddle(decisionPoint, left, right)
    chainCount = @calculateChainCount(tree)
    rootX = middle # if decisionPoint is leaf, there's not much to do

    # if the decision point has 2 children, draw them and remember their position
    if decisionPoint.children.length > 1

      topChildren = @calculateChildTreeTop(mode, chainCount, top)
      c1 = @drawTreeWithWidths(decisionPoint.children[0], left,  middle, topChildren, mode)
      c2 = @drawTreeWithWidths(decisionPoint.children[1], middle, right, topChildren, mode)

      # set the root's x coordinate to be in between the decisionPoint's children
      rootX = (c1.rootX + c2.rootX) / 2

      # draw edges from last node in 'chain' (or root, if chain empty)
      # and the decisionPoint's children
      @drawEdge(rootX, topChildren - @nodeDistance, c1.rootX, c1.top)
      @drawEdge(rootX, topChildren - @nodeDistance, c2.rootX, c2.top)

    if mode == @MODE_NORMAL or chainCount < 3
      # Draw the chain and the root, connect them.
      node = tree
      for i in [0..chainCount]
        @drawNode(rootX, top + i * @nodeDistance, node.id)
        node = node.children[0]
        if i != 0
          @drawEdge(rootX, top + (i - 1) * @nodeDistance, rootX, top + i * @nodeDistance)

    else if mode == @MODE_NOCHAIN

      # Find out, if the chain contains an active node
      node = tree.children[0]; hasActiveNode = false
      for i in [0...(chainCount - 1)]
        hasActiveNode |= node.id == @activeNodeId
        node = node.children[0]

      # Draw root, chain indicator and decision point
      @drawNode(rootX, top, tree.id)
      @drawEdge(rootX, top, rootX, top + 0.5 * @nodeDistance)
      @drawChainIndicator(rootX, top + 0.5 * @nodeDistance, top + 1.5 * @nodeDistance, hasActiveNode)
      @drawEdge(rootX, top + 1.5 * @nodeDistance, rootX, top + 2 * @nodeDistance)
      @drawNode(rootX, top + 2 * @nodeDistance, decisionPoint.id)

    return { rootX, top }

  ###*
   * calculate m (middle that divides the left and right tree, if any)
   * @param  {Object} decisionPoint  a point which definitely has to be drawn
   * @param  {Number} left           left border in pixels
   * @param  {Number} right          right border in pixels
   * @return {Number}                middle in pixels
  ###
  calculateTreeMiddle : (decisionPoint, left, right) ->

    if decisionPoint.children.length < 2
      return (left + right) / 2
    else
      child1 = decisionPoint.children[0]
      child2 = decisionPoint.children[1]
      return (right - left) * child1.width / (child1.width + child2.width) + left

  # Calculate the length of the 'chain' of nodes with one child,
  # because they all share the root's x coordinate
  calculateChainCount : (tree) ->

    chainCount = 0
    subTree = tree
    while subTree.children.length == 1
      subTree = subTree.children[0]
      chainCount++

    return chainCount

  # Calculate the top of the children
  calculateChildTreeTop : (mode, chainCount, top) ->

      if mode == @MODE_NORMAL or chainCount < 3
        return top + (chainCount + 1) * @nodeDistance
      else if mode == @MODE_NOCHAIN
        return top + 3 * @nodeDistance


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


  getNextDecisionPoint : (tree) ->

    # Decision point is any point with point.children.length != 1
    while tree.children.length == 1
      tree = tree.children[0]
    return tree


  recordWidths : (tree) ->

    # Because any node with children.length == 1 has
    # the same width as its child, we can skip those.

    # Leaves just have a width of one
    decisionPoint = @getNextDecisionPoint(tree)
    if decisionPoint.children.length == 0
      decisionPoint.width = 1
      return 1

    # Branchpoints are as wide as its children combined.
    # But actually, we need the width of the children
    result = 0
    if decisionPoint.children.length > 2
      decisionPoint.children = decisionPoint.children[0...2]

    for child in decisionPoint.children
      child.width = @recordWidths(child)
      result += child.width
    return result


  getMaxTreeDepth : (tree, mode = @MODE_NORMAL, count = 0) ->

    unless tree
      return count

    # One decision point
    count++

    # Count non decision points
    chainCount = 0
    while tree.children.length == 1
      tree = tree.children[0]
      chainCount++
    if mode == @MODE_NOCHAIN
      chainCount = Math.min(chainCount, 2)
    count += chainCount

    if tree.children.length == 0
      return count
    return Math.max(@getMaxTreeDepth(tree.children[0], mode, count),
              @getMaxTreeDepth(tree.children[1], mode, count))


  getIdFromPos : (x, y) =>

    for entry in @nodeList
      if Math.abs(x - entry.x) <= @CLICK_TRESHOLD &&
          Math.abs(y - entry.y) <= @CLICK_TRESHOLD
        return entry.id


  nodeHasComment : (id) ->

    return @RENDER_COMMENTS and @comments.hasCommentWithNodeId(id)


