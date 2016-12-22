app                     = require("app")
ResizableBuffer         = require("libs/resizable_buffer")
ErrorHandling           = require("libs/error_handling")
THREE                   = require("three")
TWEEN                   = require("tween.js")
ColorConverter          = require("three.color")
ParticleMaterialFactory = require("./materials/particle_material_factory")

class Tree

  constructor : (treeId, treeColor, @model) ->
    # create skeletonTracing to show in TDView and pre-allocate buffers

    edgeGeometry = new THREE.BufferGeometry()
    nodeGeometry = new THREE.BufferGeometry()

    edgeGeometry.addAttribute('position', Float32Array, 0, 3)
    nodeGeometry.addAttribute('position', Float32Array, 0, 3)
    nodeGeometry.addAttribute('sizeNm', Float32Array, 0, 1)
    nodeGeometry.addAttribute('nodeScaleFactor', Float32Array, 0, 1)
    nodeGeometry.addAttribute('color', Float32Array, 0, 3)

    @nodeIDs = nodeGeometry.nodeIDs = new ResizableBuffer(1, 100, Int32Array)
    edgeGeometry.dynamic = true
    nodeGeometry.dynamic = true

    @edgesBuffer = edgeGeometry.attributes.position._rBuffer = new ResizableBuffer(6)
    @nodesBuffer = nodeGeometry.attributes.position._rBuffer = new ResizableBuffer(3)
    @sizesBuffer = nodeGeometry.attributes.sizeNm._rBuffer = new ResizableBuffer(1)
    @scalesBuffer = nodeGeometry.attributes.nodeScaleFactor._rBuffer = new ResizableBuffer(1)
    @nodesColorBuffer = nodeGeometry.attributes.color._rBuffer = new ResizableBuffer(3)

    @edges = new THREE.Line(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: @darkenHex( treeColor ),
        linewidth: @getLineWidth()}),
      THREE.LinePieces
    )

    @particleMaterial = new ParticleMaterialFactory(@model).getMaterial()
    @nodes = new THREE.ParticleSystem(nodeGeometry, @particleMaterial)

    @id = treeId


  clear : ->

    @nodesBuffer.clear()
    @edgesBuffer.clear()
    @sizesBuffer.clear()
    @scalesBuffer.clear()
    @nodeIDs.clear()
    @updateNodesColors()


  isEmpty : ->

    return @nodesBuffer.getLength() == 0


  addNode : (node) ->

    @nodesBuffer.push(node.pos)
    @sizesBuffer.push([node.radius * 2])
    @scalesBuffer.push([1.0])
    @nodeIDs.push([node.id])
    @nodesColorBuffer.push(@getColor(node.id))

    # Add any edge from smaller IDs to the node
    # ASSUMPTION: if this node is new, it should have a
    #             greater id as its neighbor
    for neighbor in node.neighbors
      if neighbor.id < node.id
        @edgesBuffer.push(neighbor.pos.concat(node.pos))

    @updateGeometries()


  addNodes : (nodeList) ->

    for node in nodeList
      @addNode(node)


  deleteNode : (node) ->

    swapLast = (array, index) =>
      lastElement = array.pop()
      for i in [0...array.elementLength]
        array.getAllElements()[index * array.elementLength + i] = lastElement[i]

    nodesIndex = @getNodeIndex(node.id)
    ErrorHandling.assert(nodesIndex?, "No node found.", { id : node.id, @nodeIDs })

    # swap IDs and nodes
    swapLast( @nodeIDs, nodesIndex )
    swapLast( @nodesBuffer, nodesIndex )
    swapLast( @sizesBuffer, nodesIndex )
    swapLast( @scalesBuffer, nodesIndex )
    swapLast( @nodesColorBuffer, nodesIndex )

    # Delete Edge by finding it in the array
    edgeArray = @getEdgeArray(node, node.neighbors[0])

    for i in [0...@edgesBuffer.getLength()]
      found = true
      for j in [0..5]
        found &= Math.abs(@edges.geometry.attributes.position.array[6 * i + j] - edgeArray[j]) < 0.5
      if found
        edgesIndex = i
        break

    ErrorHandling.assert(found, "No edge found.", { found, edgeArray, nodesIndex })

    swapLast(@edgesBuffer, edgesIndex)

    @updateGeometries()

  mergeTree : (otherTree, lastNode, activeNode) ->

    merge = (property) =>
      @[property].pushSubarray(otherTree[property].getAllElements())

    # merge IDs, nodes and edges
    merge("nodeIDs")
    merge("nodesBuffer")
    merge("edgesBuffer")
    merge("sizesBuffer")
    merge("scalesBuffer")
    @edgesBuffer.push(@getEdgeArray(lastNode, activeNode))

    @updateNodesColors()
    @updateGeometries()


  getEdgeArray : (node1, node2) ->
    # ASSUMPTION: edges always go from smaller ID to bigger ID

    if node1.id < node2.id
      return node1.pos.concat(node2.pos)
    else
      return node2.pos.concat(node1.pos)


  setSizeAttenuation : (sizeAttenuation) ->

    @nodes.material.sizeAttenuation = sizeAttenuation
    @updateGeometries()


  updateTreeColor : ->

    newColor = @model.skeletonTracing.getTree(@id).color
    @edges.material.color = new THREE.Color(@darkenHex(newColor))

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
    for i in [0...@nodeIDs.length]
      @nodesColorBuffer.push(@getColor(@nodeIDs.get(i)))

    @updateGeometries()


  updateNodeColor : (id, isActiveNode, isBranchPoint) ->

    @doWithNodeIndex(id, (index) =>
      @nodesColorBuffer.set(@getColor(id, isActiveNode, isBranchPoint), index)
    )

    @updateGeometries()


  updateNodeRadius : (id, radius) ->

    @doWithNodeIndex(id, (index) =>
      @sizesBuffer.set([radius * 2], index)
    )

    @updateGeometries()


  startNodeHighlightAnimation : (nodeId) ->

    normal = 1.0
    highlighted = 2.0

    @doWithNodeIndex(nodeId, (index) =>
      @animateNodeScale(normal, highlighted, index, =>
        @animateNodeScale(highlighted, normal, index)
      )
    )


  animateNodeScale : (from, to, index, onComplete = ->) ->

    setScaleFactor = (factor) =>
      @scalesBuffer.set([factor], index)
    redraw = =>
      @updateGeometries()
      app.vent.trigger("rerender")
    onUpdate = ->
      setScaleFactor(@scaleFactor)
      redraw()

    (new TWEEN.Tween({scaleFactor : from}))
      .to({scaleFactor : to}, 100)
      .onUpdate(onUpdate)
      .onComplete(onComplete)
      .start()


  getColor : (id, isActiveNode, isBranchPoint) ->

    tree = @model.skeletonTracing.getTree(@id)
    color = tree.color
    if id?

      isActiveNode  = isActiveNode  || @model.skeletonTracing.getActiveNodeId() == id
      isBranchPoint = isBranchPoint || tree.isBranchPoint(id)

      if isActiveNode
        color = @shiftHex(color, 1/4)
      else
        color = @darkenHex(color)

      if isBranchPoint
        color = @invertHex(color)

    return @hexToRGB(color)


  showRadius : (show) ->

    @edges.material.linewidth = @getLineWidth()
    @particleMaterial.setShowRadius(show)


  updateGeometries : ->

    for mesh in [ @edges, @nodes ]
      for attr of mesh.geometry.attributes
        a = mesh.geometry.attributes[attr]
        a.array       = a._rBuffer.getBuffer()
        a.numItems    = a._rBuffer.getBufferLength()
        a.needsUpdate = true


  logState : (title) ->

    console.log " +++ " + title + " +++ "
    console.log "nodeIDs", @nodeIDs.toString()
    console.log "nodesBuffer", @nodesBuffer.toString()
    console.log "edgesBuffer", @edgesBuffer.toString()
    console.log "sizesBuffer", @sizesBuffer.toString()


  getNodeIndex : (nodeId) ->

    for i in [0..@nodeIDs.length]
      if @nodeIDs.get(i) == nodeId
        return i


  doWithNodeIndex : (nodeId, f) ->

    index = @getNodeIndex(nodeId)
    return unless index?
    f(index)


  getLineWidth : ->

    return @model.user.get("particleSize") / 4


  #### Color utility methods

  hexToRGB : (hexColor) ->

    rgbColor = new THREE.Color().setHex(hexColor)
    [rgbColor.r, rgbColor.g, rgbColor.b]


  darkenHex : (hexColor) ->

    hsvColor = ColorConverter.getHSV(new THREE.Color().setHex(hexColor))
    hsvColor.v = 0.6
    ColorConverter.setHSV(new THREE.Color(), hsvColor.h, hsvColor.s, hsvColor.v).getHex()


  shiftHex : (hexColor, shiftValue) ->

    hsvColor = ColorConverter.getHSV(new THREE.Color().setHex(hexColor))
    hsvColor.h = (hsvColor.h + shiftValue) % 1
    ColorConverter.setHSV(new THREE.Color(), hsvColor.h, hsvColor.s, hsvColor.v).getHex()


  invertHex : (hexColor) ->

    @shiftHex(hexColor, 0.5)

module.exports = Tree
