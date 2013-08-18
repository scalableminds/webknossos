### define
../../libs/resizable_buffer : ResizableBuffer
###

class Tree

  constructor : (treeId, color, @model) ->
    # create cellTracing to show in TDView and pre-allocate buffers

    edgeGeometry = new THREE.Geometry()
    nodeGeometry = new THREE.Geometry()
    nodeGeometry.nodeIDs = new ResizableBuffer(1, 100, Int32Array)
    edgeGeometry.dynamic = true
    nodeGeometry.dynamic = true

    @edgesBuffer = new ResizableBuffer(6)
    @nodesBuffer = new ResizableBuffer(3)

    @edges = new THREE.Line(
      edgeGeometry, 
      new THREE.LineBasicMaterial({
        color: color, 
        linewidth: @model.user.particleSize / 4}), THREE.LinePieces)

    @nodes = new THREE.ParticleSystem(
      nodeGeometry, 
      new THREE.ParticleBasicMaterial({
        color: color, 
        size: @model.user.particleSize, 
        sizeAttenuation : false}))

    @edges.__abc = true
    @nodes.__abc = true

    @id = treeId


  clear : ->

    @nodesBuffer.clear()
    @edgesBuffer.clear()
    @nodes.geometry.nodeIDs.clear()


  isEmpty : ->

    return @nodesBuffer.getLength() == 0


  addNode : (node) ->

    @nodesBuffer.push(node.pos)
    @nodes.geometry.nodeIDs.push([node.id])

    # Add any edge from smaller IDs to the node
    # ASSUMPTION: if this node is new, it should have a
    #             greater id as its neighbor
    for neighbor in node.neighbors
      if neighbor.id < node.id
        @edgesBuffer.push(neighbor.pos.concat(node.pos))

    @updateGeometries()


  addNodesAndEdges : (nodeList) ->

    for node in nodeList
      @addNode( node )


  deleteNode : (node) ->

    nodeIds  = @nodes.geometry.nodeIDs

    swapLast = (array, index) ->
      lastElement = array.pop()
      for i in [0..array.elementLength]
        @nodesBuffer.getAllElements()[index * array.elementLength + i] = lastElement[i]

    # Find index
    for i in [0...nodeIDs.getLength()]
      if nodeIDs.get(i) == node.id
        nodesIndex = i
        break

    # swap IDs and nodes
    swapLast( nodeIDs, nodesIndex )
    swapLast( @nodesBuffer, nodesIndex )

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

    @updateGeometries()

  mergeTree : (otherTree, lastNode, activeNode) ->

    merge = (property) =>
      @[property].pushSubarray(otherTree[property].getAllElements())

    # merge IDs, nodes and edges
    merge("nodes.geometry.nodeIDs")
    merge("nodesBuffer")
    merge("edgesBuffer")
    @edgesBuffer.push( @getEdgeArray(lastNode.id, activeNode.id) )

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


  updateColor : ( newTreeId, color ) ->

    @id = newTreeId

    @nodes.material.color = color
    @edges.material.color = color
    @updateGeometries()


  getGeometries : ->

    return [ @edges, @nodes ]
  

  updateGeometries: ->

    @edges.__vertexArray        = @edgesBuffer.getBuffer()
    @edges.__webglLineCount     = @edgesBuffer.getLength() * 2
    @nodes.__vertexArray        = @nodesBuffer.getBuffer()
    @nodes.__webglParticleCount =  @nodesBuffer.getLength()

    @edges.verticesNeedUpdate   = true
    @nodes.verticesNeedUpdate   = true


  dispose : ->

    for geometry in @getGeometries()

      geometry.geometry.dispose()
      geometry.material.dispose()