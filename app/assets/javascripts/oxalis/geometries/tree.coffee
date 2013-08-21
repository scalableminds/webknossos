### define
../../libs/resizable_buffer : ResizableBuffer
libs/threejs/ColorConverter : ColorConverter
###

class Tree

  constructor : (treeId, treeColor, @model) ->
    # create cellTracing to show in TDView and pre-allocate buffers

    edgeGeometry = new THREE.Geometry()
    nodeGeometry = new THREE.Geometry()
    @nodeIDs = nodeGeometry.nodeIDs = new ResizableBuffer(1, 100, Int32Array)
    edgeGeometry.dynamic = true
    nodeGeometry.dynamic = true

    @edgesBuffer = new ResizableBuffer(6)
    @nodesBuffer = new ResizableBuffer(3)

    @edges = new THREE.Line(
      edgeGeometry, 
      new THREE.LineBasicMaterial({
        color: @darkenHex( treeColor ), 
        linewidth: @model.user.particleSize / 4}), THREE.LinePieces)

    @nodes = new THREE.ParticleSystem(
      nodeGeometry, 
      new THREE.ParticleBasicMaterial({
        vertexColors: true, 
        size: @model.user.particleSize, 
        sizeAttenuation : false}))

    @nodesColorBuffer = new ResizableBuffer(3)

    @id = treeId


  clear : ->

    @nodesBuffer.clear()
    @edgesBuffer.clear()
    @nodeIDs.clear()


  isEmpty : ->

    return @nodesBuffer.getLength() == 0


  addNode : (node) ->

    @nodesBuffer.push(node.pos)
    @nodeIDs.push([node.id])
    @nodesColorBuffer.push( @getColor(node.id) )

    # Add any edge from smaller IDs to the node
    # ASSUMPTION: if this node is new, it should have a
    #             greater id as its neighbor
    for neighbor in node.neighbors
      if neighbor.id < node.id
        @edgesBuffer.push(neighbor.pos.concat(node.pos))

    @updateColors()
    @updateGeometries()


  addNodes : (nodeList) ->

    for node in nodeList
      @addNode( node )


  deleteNode : (node) ->

    swapLast = (array, index) =>
      lastElement = array.pop()
      for i in [0..array.elementLength]
        array.getAllElements()[index * array.elementLength + i] = lastElement[i]

    # Find index
    for i in [0...@nodeIDs.getLength()]
      if @nodeIDs.get(i) == node.id
        nodesIndex = i
        break

    # swap IDs and nodes
    swapLast( @nodeIDs, nodesIndex )
    swapLast( @nodesBuffer, nodesIndex )
    swapLast( @nodesColorBuffer, nodesIndex )

    # Delete Edge by finding it in the array
    edgeArray = @getEdgeArray( node, node.neighbors[0] )

    for i in [0...@edgesBuffer.getLength()]
      found = true
      for j in [0..5]
        found &= Math.abs(@edges.geometry.__vertexArray[6 * i + j] - edgeArray[j]) < 0.01
      if found
        edgesIndex = i
        break

    $.assert(found,
      "No edge found.", found)

    swapLast( @edgesBuffer, edgesIndex )

    @updateColors()
    @updateGeometries()

  mergeTree : (otherTree, lastNode, activeNode) ->

    merge = (property) =>
      @[property].pushSubarray(otherTree[property].getAllElements())

    # merge IDs, nodes and edges
    merge("nodeIDs")
    merge("nodesBuffer")
    merge("edgesBuffer")
    @edgesBuffer.push( @getEdgeArray(lastNode, activeNode) )

    @updateNodesColors()
    @updateGeometries()


  getEdgeArray : (node1, node2) ->
    # ASSUMPTION: edges always go from smaller ID to bigger ID

    if node1.id < node2.id
      return node1.pos.concat(node2.pos)
    else
      return node2.pos.concat(node1.pos)


  setSize : (size) ->

    @nodes.material.size = size
    @edges.material.linewidth = size / 4


  setSizeAttenuation : (sizeAttenuation) ->

    @nodes.material.sizeAttenuation = sizeAttenuation
    @updateGeometries()


  updateTreeColor : ( newTreeId ) ->

    @id = newTreeId

    newColor = @model.cellTracing.getTree().color
    @edges.material.color = new THREE.Color( @darkenHex( newColor ) )
    
    @updateNodesColors()
    @updateGeometries()


  getMeshes : ->

    return [ @edges, @nodes ]


  dispose : ->

    for geometry in @getMeshes()

      geometry.geometry.dispose()
      geometry.material.dispose()


  updateNodesColors : ->

    @nodesColorBuffer.clear()
    for i in [0..@nodeIDs.length]
      @nodesColorBuffer.push( @getColor( @nodeIDs.get(i) ))

    @updateColors()


  updateNodeColor : (id, isActiveNode, isBranchPoint) ->

    for i in [0..@nodeIDs.length]
      if @nodeIDs.get(i) == id
        @nodesColorBuffer.set( @getColor( id, isActiveNode, isBranchPoint ), i )

    @updateColors()


  getColor : (id, isActiveNode, isBranchPoint) ->

    color = @model.cellTracing.getTree(@id).color
    if id?

      isActiveNode  = isActiveNode  || @model.cellTracing.getActiveNodeId() == id
      isBranchPoint = isBranchPoint || @model.cellTracing.isBranchPoint(id)

      if not isActiveNode
        color = @darkenHex(color)
      if isBranchPoint
        color = @invertHex(color)

    return @hexToRGB( color )


  updateColors : ->

    @nodes.geometry.__colorArray = @nodesColorBuffer.getBuffer()
    @nodes.geometry.colorsNeedUpdate = true
  

  updateGeometries : ->

    @edges.geometry.__vertexArray        = @edgesBuffer.getBuffer()
    @edges.geometry.__webglLineCount     = @edgesBuffer.getLength() * 2
    @nodes.geometry.__vertexArray        = @nodesBuffer.getBuffer()
    @nodes.geometry.__webglParticleCount = @nodesBuffer.getLength()

    @edges.geometry.verticesNeedUpdate   = true
    @nodes.geometry.verticesNeedUpdate   = true

    
  #### Color utility methods

  hexToRGB : (hexColor) ->

    rgbColor = new THREE.Color().setHex(hexColor)
    [rgbColor.r, rgbColor.g, rgbColor.b]


  darkenHex : (hexColor) ->

    hsvColor = ColorConverter.getHSV(new THREE.Color().setHex(hexColor))
    hsvColor.v = 0.6
    ColorConverter.setHSV(new THREE.Color(), hsvColor.h, hsvColor.s, hsvColor.v).getHex()


  invertHex : (hexColor) ->

    hsvColor = ColorConverter.getHSV(new THREE.Color().setHex(hexColor))
    hsvColor.h = (hsvColor.h + 0.5) % 1
    ColorConverter.setHSV(new THREE.Color(), hsvColor.h, hsvColor.s, hsvColor.v).getHex()