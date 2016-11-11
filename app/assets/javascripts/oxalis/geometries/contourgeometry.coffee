app             = require("app")
Backbone        = require("backbone")
ResizableBuffer = require("libs/resizable_buffer")
THREE           = require("three")
Dimensions      = require("../model/dimensions")
constants       = require("../constants")

class ContourGeometry

  COLOR_NORMAL : new THREE.Color(0x0000ff)
  COLOR_DELETE : new THREE.Color(0xff0000)

  constructor : (@volumeTracing, @flycam) ->

    _.extend(this, Backbone.Events)

    @color = @COLOR_NORMAL

    @listenTo(@volumeTracing, "volumeAnnotated", @reset)
    @listenTo(@volumeTracing, "updateLayer", (cellId, contourList) ->
      @color = if cellId == 0 then @COLOR_DELETE else @COLOR_NORMAL
      @reset()
      for p in contourList
        @addEdgePoint(p)
    )

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

    app.vent.trigger("rerender")


  finalizeMesh : (mesh) ->

    positionAttribute = mesh.geometry.attributes.position

    positionAttribute.array       = mesh.vertexBuffer.getBuffer()
    positionAttribute.numItems    = mesh.vertexBuffer.getLength() * 3
    positionAttribute.needsUpdate = true

module.exports = ContourGeometry
