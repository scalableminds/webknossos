### define ###

NODE_RADIUS = 3
NODE_DISTANCE = 20

class AbsractTreeViewer
  constructor : (width, height) ->
    @canvas = $("<canvas>", {id : "abstractTreeViewerCanvas"})
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

    @recordWidths(tree)
    @drawTreeWithWidths(tree, 0, @width, 30)

    #@getAbstractNodePositions(tree, 0, @width, 30)
    #while (true)
    #  @drawNode(tree.abstractX, tree.abstractY)
    #  if tree.children[0]
    #    tree = tree.children[0]
    #  else
    #    break

    #@drawNode(@width / 2, 30)
    #@drawEdge(@width / 2, 30, @width / 2, 50)
    #@drawNode(@width / 2, 50)

  drawTreeWithWidths : (tree, left, right, top) ->
    decisionPoint = @getNextDecisionPoint(tree)
    if decisionPoint.children.length == 0
      x = (right - left) / 2 + left
    else
      c1 = decisionPoint.children[0]
      c2 = decisionPoint.children[1]
      x = (right - left) * c1.width / (c1.width + c2.width) + left
    x2 = (right - left) / 2 + left
    @drawNode(x2, top)
    top2 = top
    while tree.children.length == 1
      tree = tree.children[0]
      top2 += NODE_DISTANCE
      @drawNode(x2, top2)
      @drawEdge(x2, top2 - NODE_DISTANCE, x2, top2)
    if tree.children.length > 0
      c1 = @drawTreeWithWidths(tree.children[0], left, x, top2 + NODE_DISTANCE)
      c2 = @drawTreeWithWidths(tree.children[1], x, right, top2 + NODE_DISTANCE)
      @drawEdge(x2, top2, c1[0], c1[1])
      @drawEdge(x2, top2, c2[0], c2[1])
    return [x2, top]

  drawNode : (x, y) ->
    @ctx.beginPath()
    @ctx.fillStyle = "#000000"
    @ctx.arc(x, y, NODE_RADIUS, 0, 2 * Math.PI)
    @ctx.fill()

  drawEdge : (x1, y1, x2, y2) ->
    @ctx.beginPath()
    @ctx.fillStyle = "#000000"
    @ctx.moveTo(x1, y1)
    @ctx.lineTo(x2, y2)
    @ctx.stroke()

  getNextDecisionPoint : (tree) ->
    while tree.children.length == 1
      tree = tree.children[0]
    return tree

  recordWidths : (tree) ->
    decisionPoint = @getNextDecisionPoint(tree)
    if decisionPoint.children.length == 0
      decisionPoint.width = 1
      return 1

    result = 0
    for child in decisionPoint.children
      child.width = @recordWidths(child)
      result += child.width
    return result

  getAbstractNodePositions : (tree, left, right, top) ->
    # root is fix
    tree.abstractX = (right - left) / 2
    tree.abstractY = top

    offset = 30
    offsetCounter = 1

    while true
      if tree.children.length == 0
        return
      if tree.children.length == 1
        tree = tree.children[0]
        tree.abstractX = (right - left) / 2
        tree.abstractY = top + offsetCounter * offset
        offsetCounter++
    
    # Deal with branchpoints
    i = 0
    for child in tree.children
      @getAbstractNodePositions(child, left + i * (right - left) / tree.children.length,
                                       left + (i + 1) * (right - left) / tree.children.length,
                                       top + offsetCounter * offset)