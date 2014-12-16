### define
backbone : Backbone
../model/dimensions : Dimensions
../../libs/resizable_buffer : ResizableBuffer
../constants : constants
three : THREE
###

COLOR_ARRAY      = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0x00ffff, 0xff00ff]

class CellLayer

  constructor : (@volumeTracing, @flycam) ->

    _.extend(this, Backbone.Events)

    @color = 0x000000

    @listenTo(@volumeTracing, "volumeAnnotated", @reset)
    @listenTo(@volumeTracing, "updateLayer", (contourList) ->
      @reset()
      for p in contourList
        @addEdgePoint(p)
    )

    @createMeshes()


  createMeshes : ->

    edgeGeometry = new THREE.BufferGeometry()
    edgeGeometry.addAttribute( 'position', Float32Array, 0, 3 )
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

    @flycam.update()


  finalizeMesh : (mesh) ->

    positionAttribute = mesh.geometry.attributes.position

    positionAttribute.array       = mesh.vertexBuffer.getBuffer()
    positionAttribute.numItems    = mesh.vertexBuffer.getLength() * 3
    positionAttribute.needsUpdate = true

