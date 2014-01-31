### define
../../libs/resizable_buffer : ResizableBuffer
libs/threejs/ColorConverter : ColorConverter
./materials/particle_material_factory : ParticleMaterialFactory
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
    @sizesBuffer = new ResizableBuffer(1)
    @nodesColorBuffer = new ResizableBuffer(3)

    @edges = new THREE.Line(
      edgeGeometry, 
      new THREE.LineBasicMaterial({
        color: @darkenHex( treeColor ), 
        linewidth: @model.user.particleSize / 4}), THREE.LinePieces)

    @particleMaterial = new ParticleMaterialFactory(@model).getMaterial()
    @nodes = new THREE.ParticleSystem(
      nodeGeometry, @particleMaterial )

    @id = treeId


  clear : ->

    @nodesBuffer.clear()
    @edgesBuffer.clear()
    @sizesBuffer.clear()
    @nodeIDs.clear()


  isEmpty : ->

    return @nodesBuffer.getLength() == 0


  addNode : (node) ->

    @nodesBuffer.push(node.pos)
    @sizesBuffer.push([node.radius * 2])
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
    swapLast( @sizesBuffer, nodesIndex )
    swapLast( @nodesColorBuffer, nodesIndex )

    # Delete Edge by finding it in the array
    edgeArray = @getEdgeArray( node, node.neighbors[0] )

    for i in [0...@edgesBuffer.getLength()]
      found = true
      for j in [0..5]
        found &= Math.abs(@edges.geometry.__vertexArray[6 * i + j] - edgeArray[j]) < 0.5
      if found
        edgesIndex = i
        break

    $.assert(found,
      "No edge found.", { found, edgeArray, nodesIndex })

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
    merge("sizesBuffer")
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


  updateNodeRadius : (id, radius) ->

    for i in [0..@nodeIDs.length]
      if @nodeIDs.get(i) == id
        @sizesBuffer.set( [radius * 2], i )

    @updateGeometries()


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


  showRadius : (show) ->

    @particleMaterial.setShowRadius( show )
  

  updateGeometries : ->

    @edges.geometry.__vertexArray        = @edgesBuffer.getBuffer()
    @edges.geometry.__webglLineCount     = @edgesBuffer.getLength() * 2
    @nodes.geometry.__vertexArray        = @nodesBuffer.getBuffer()
    @nodes.geometry.__webglParticleCount = @nodesBuffer.getLength()
    @particleMaterial.setSizes( @sizesBuffer.getBuffer() )

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