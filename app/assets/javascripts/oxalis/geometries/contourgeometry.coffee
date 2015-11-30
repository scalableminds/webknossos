### define
../../libs/event_mixin : EventMixin
../model/dimensions : Dimensions
../../libs/resizable_buffer : ResizableBuffer
../constants : constants
three : THREE
###

class CellLayer

  COLOR_NORMAL : new THREE.Color(0x000000)
  COLOR_DELETE : new THREE.Color(0xff0000)

  constructor : (@volumeTracing, @flycam) ->

    _.extend(this, new EventMixin())

    @color = @COLOR_NORMAL

    @volumeTracing.on({
      updateLayer : (cellId, contourList) =>
        @color = if cellId == 0 then @COLOR_DELETE else @COLOR_NORMAL
        @reset()
        for p in contourList
          @addEdgePoint(p)
      volumeAnnotated : =>
        @reset()
      })

    @createMeshes()


  createMeshes : ->

    edgeGeometry = new THREE.BufferGeometry()
    edgeGeometry.addAttribute( 'position', Float32Array, 0, 3 )
    edgeGeometry.dynamic = true

    @edge = new THREE.Line(edgeGeometry, new THREE.LineBasicMaterial({linewidth: 2}), THREE.LineStrip)
    @edge.vertexBuffer = new ResizableBuffer(3)

    @reset()


  reset : ->

    @edge.material.color = @color
    @edge.vertexBuffer.clear()
    @finalizeMesh(@edge)


  getMeshes : ->

    return [@edge]


  addEdgePoint : (pos) ->

    # pos might be integer, but the third dimension needs to be exact.
    globalPos = @flycam.getPosition()
    edgePoint = pos.slice()
    edgePoint[@thirdDimension] = globalPos[@thirdDimension]

    @edge.vertexBuffer.push(edgePoint)
    @finalizeMesh(@edge)

    @flycam.update()


  finalizeMesh : (mesh) ->

    positionAttribute = mesh.geometry.attributes.position

    positionAttribute.array       = mesh.vertexBuffer.getBuffer()
    positionAttribute.numItems    = mesh.vertexBuffer.getLength() * 3
    positionAttribute.needsUpdate = true

