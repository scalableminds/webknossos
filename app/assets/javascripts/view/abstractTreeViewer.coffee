### define
libs/event_mixin : EventMixin
###

NODE_RADIUS = 2
MAX_NODE_DISTANCE = 100
CLICK_TRESHOLD = 4

MODE_NORMAL = 0     # draw every node and the complete tree
MODE_NOCHAIN = 1    # draw only decision points

class AbsractTreeViewer
  constructor : (width, height) ->

    _.extend(this, new EventMixin())

    @canvas = $("<canvas>", {id : "abstractTreeViewerCanvas"})
    @canvas.click(@onClick)
    $(@canvas).css(
        width : width
        height : height
        border : "2px"
      )
    @canvas[0].width = @canvas.width()
    @canvas[0].height = @canvas.height()
    @ctx = @canvas[0].getContext("2d")
    console.log(@ctx)
    @width = width
    @height = height

  drawTree : (tree) ->
    # clear Background
    @ctx.fillStyle = "#ffffff"
    @ctx.fillRect(0, 0, @width, @height)

    # List of {x : ..., y : ..., id: ...} objects
    @nodeList = []

    mode = MODE_NOCHAIN

    @nodeDistance = Math.min(@height / (@getMaxTreeDepth(tree, mode) + 1), MAX_NODE_DISTANCE)

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

    @recordWidths(tree)
    @drawTreeWithWidths(tree, 0, @width, @nodeDistance, mode)

  drawTreeWithWidths : (tree, left, right, top, mode) ->
    unless mode
      mode = MODE_NORMAL

    # get the decision point
    decisionPoint = @getNextDecisionPoint(tree)
    # calculate m (middle that divides the left and right tree, if any)
    if decisionPoint.children.length == 0
      m = (left + right) / 2
    else
      c1 = decisionPoint.children[0]
      c2 = decisionPoint.children[1]
      m = (right - left) * c1.width / (c1.width + c2.width) + left
    
    # Calculate the length of the 'chain' of nodes with one child,
    # because they all share the root's x coordinate
    chainCount = 0
    subTree = tree
    while subTree.children.length == 1
      subTree = subTree.children[0]
      chainCount++

    # if the decision point has (2) children, draw them and remember their prosition
    if decisionPoint.children.length > 0
      # Calculate the top of the children
      if mode == MODE_NORMAL or chainCount < 3
        topC = top + (chainCount + 1) * @nodeDistance
      else if mode == MODE_NOCHAIN
        topC = top + 3 * @nodeDistance

      c1 = @drawTreeWithWidths(decisionPoint.children[0], left,  m, topC, mode)
      c2 = @drawTreeWithWidths(decisionPoint.children[1], m, right, topC, mode)
      # set the root's x coordinate to be in between the decisionPoint's childs
      xr = (c1[0] + c2[0]) / 2
      # draw edges from last node in 'chain' (or root, if chain empty)
      # and the decisionPoint's children
      @drawEdge(xr, topC - @nodeDistance, c1[0], c1[1])
      @drawEdge(xr, topC - @nodeDistance, c2[0], c2[1])
    else
      # if decisionPoint is leaf, there's not much to do
      xr = m
    
    if mode == MODE_NORMAL or chainCount < 3
      # Draw the chain and the root, connect them.
      node = tree
      for i in [0..chainCount]
        @drawNode(xr, top + i * @nodeDistance, node.id)
        node = node.children[0]
        if i != 0
          @drawEdge(xr, top + (i - 1) * @nodeDistance, xr, top + i * @nodeDistance)
    else if mode == MODE_NOCHAIN
      # Draw root, chain indicator and decision point
      @drawNode(xr, top, tree.id)
      @drawEdge(xr, top, xr, top + 0.5 * @nodeDistance)
      @drawChainIndicator(xr, top + 0.5 * @nodeDistance, top + 1.5 * @nodeDistance)
      @drawEdge(xr, top + 1.5 * @nodeDistance, xr, top + 2 * @nodeDistance)
      @drawNode(xr, top + 2 * @nodeDistance, decisionPoint.id)

    return [xr, top]

  drawNode : (x, y, id) ->
    @ctx.beginPath()
    @ctx.fillStyle = "#000000"
    @ctx.arc(x, y, NODE_RADIUS, 0, 2 * Math.PI)
    @ctx.fill()
    # put it in nodeList
    @nodeList.push({x : x, y : y, id : id})

  drawEdge : (x1, y1, x2, y2) ->
    @ctx.beginPath()
    @ctx.strokeStyle = "#000000"
    @ctx.moveTo(x1, y1)
    @ctx.lineTo(x2, y2)
    @ctx.stroke()

  drawChainIndicator : (x, top, bottom) ->
    # Draw a dashed line
    dashLength = (bottom - top) / 7
    @ctx.beginPath()
    @ctx.strokeStyle = "#000000"
    for i in [0, 1, 2]
      @ctx.moveTo(x, top + (2 * i + 1) * dashLength)
      @ctx.lineTo(x, top + (2 * i + 2) * dashLength)
    @ctx.stroke()

  # Decision point is any point with point.children.length != 1
  getNextDecisionPoint : (tree) ->
    while tree.children.length == 1
      tree = tree.children[0]
    return tree

  recordWidths : (tree) ->
    # Because any node with children.length == 1 has
    # the same width as its child, we can skip those.

    # Leafs just have a width of one
    decisionPoint = @getNextDecisionPoint(tree)
    if decisionPoint.children.length == 0
      decisionPoint.width = 1
      return 1
    
    # Branchpoints are as wide as its children combined.
    # But actually, we need the width of the children
    result = 0
    for child in decisionPoint.children
      child.width = @recordWidths(child)
      result += child.width
    return result

  getMaxTreeDepth : (tree, mode, count) ->
    unless count
      count = 0
    unless tree
      return count
    unless mode
      mode  = MODE_NORMAL

    # One decision point
    count++

    # Count non decision points
    chainCount = 0
    while tree.children.length == 1
      tree = tree.children[0]
      chainCount++
    if mode == MODE_NOCHAIN
      chainCount = Math.min(chainCount, 2)
    count += chainCount

    if tree.children.length == 0
      return count
    return Math.max(@getMaxTreeDepth(tree.children[0], mode, count),
              @getMaxTreeDepth(tree.children[1], mode, count))

  onClick : (evt) =>
    id = @getIdFromPos(evt.offsetX, evt.offsetY)
    if id
      @trigger "nodeClick", id

  getIdFromPos : (x, y) =>
    for entry in @nodeList
      if Math.abs(x - entry.x) <= CLICK_TRESHOLD &&
          Math.abs(y - entry.y) <= CLICK_TRESHOLD
        return entry.id