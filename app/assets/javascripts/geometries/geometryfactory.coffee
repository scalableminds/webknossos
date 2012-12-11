
GeometryFactory =

  createGeometries : (nodeList) ->

    # Apparently, we need to pass this to the geometry...
    nodesIndexArray = new Int16Array(nodeList.length*3)
    for i in [0...nodesIndexArray.length]
      nodesIndexArray[i] = i

    edgesIndexArray = new Int16Array((nodeList.length - 1)*3*2)
    for i in [0...edgesIndexArray.length]
      edgesIndexArray[i] = i

    # [nodes|edges]PosArray contains 3 values per vertex, for the x, y and z coordinates.
    nodesPosArray = new Float32Array(nodesIndexArray.length)
    for i in [0...nodeList.length]
      nodesPosArray[i * 3]     = nodeList[i].pos[0]
      nodesPosArray[i * 3 + 1] = nodeList[i].pos[1]
      nodesPosArray[i * 3 + 2] = nodeList[i].pos[2]

    edgesPosArray = new Float32Array(edgesIndexArray.length)
    for i in [0...nodeList.length]
      if nodeList[i].parent?
        edgesPosArray[ 2 * i * 3]     = nodeList[i].pos[0]
        edgesPosArray[ 2 * i * 3 + 1] = nodeList[i].pos[1]
        edgesPosArray[ 2 * i * 3 + 2] = nodeList[i].pos[2]
        edgesPosArray[(2 * i + 1) * 3]     = nodeList[i].parent.pos[0]
        edgesPosArray[(2 * i + 1) * 3 + 1] = nodeList[i].parent.pos[1]
        edgesPosArray[(2 * i + 1) * 3 + 2] = nodeList[i].parent.pos[2]

    # Create the BufferGeometry, and assign attributes to the instance.
    nodesGeometry = new THREE.BufferGeometry()

    # The attributes object contains information about how to treat the indexes, positions, normals arrays etc.
    # For example, indexes have an itemSize of 1, in other words, 1 array value per vertex index.
    # Position has 3 array values per vertex, hence, itemSize: 3.
    # array and numItems simply contain the typed array and its length.
    nodesGeometry.attributes =
      index:
        itemSize: 1
        array: nodesIndexArray
        numItems: nodesIndexArray.length
      position:
        itemSize: 3
        array: nodesPosArray
        numItems: nodesPosArray.length

    edgesGeometry = new THREE.BufferGeometry()
    edgesGeometry.attributes =
      index:
        itemSize: 1
        array: edgesIndexArray
        numItems: edgesIndexArray.length
      position:
        itemSize: 3
        array: edgesPosArray
        numItems: edgesPosArray.length
        
    nodesGeometry.offsets = [{
      start: 0
      count: nodesIndexArray.length
      index: 0
    }]
    edgesGeometry.offsets = [{
      start: 0
      count: edgesIndexArray.length
      index: 0
    }]
      
    # These are strictly not needed, but they're available, like on any normal Geometry.
    #for geometry in [nodesGeometry, edgesGeometry]
    #  geometry.computeBoundingBox()
    #  geometry.computeBoundingSphere()
    #  geometry.computeVertexNormals()

    return {nodesGeometry : nodesGeometry, edgesGeometry : edgesGeometry}