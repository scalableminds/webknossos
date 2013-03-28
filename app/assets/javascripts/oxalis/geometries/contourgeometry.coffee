### define
../../libs/event_mixin : EventMixin
../model/dimensions : Dimensions
../../libs/resizable_buffer : ResizableBuffer
../constants : constants
###

COLOR_ARRAY      = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0x00ffff, 0xff00ff]

class CellLayer

  constructor : (@volumeTracing, @flycam) ->

    _.extend(this, new EventMixin())

    @color = 0x000000

    @volumeTracing.on({
      updateLayer : (contourList) =>
        @reset()
        for p in contourList
          @addEdgePoint(p)
      resetContour : =>
        @reset()
      })

    @createMeshes()

  createMeshes : ->

    edgeGeometry = new THREE.Geometry()
    edgeGeometry.dynamic = true

    @edge = new THREE.Line(edgeGeometry, new THREE.LineBasicMaterial({color: @color, linewidth: 2}), THREE.LineStrip)
    @edge.vertexBuffer = new ResizableBuffer(3)

    @reset()

  reset : ->
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
    
    @flycam.hasChanged = true

  finalizeMesh : (mesh) ->
    mesh.geometry.__vertexArray = mesh.vertexBuffer.getBuffer()
    mesh.geometry.__webglLineCount = mesh.vertexBuffer.getLength()
    mesh.geometry.verticesNeedUpdate = true