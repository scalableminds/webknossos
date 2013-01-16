### define
../../libs/event_mixin : EventMixin
###

MAX_EDGE_POINTS  = 10000

class CellLayer

  constructor : (@flycam, @model) ->

    _.extend(this, new EventMixin())

    @scaleVector  = @model.scaleInfo.getVoxelPerNMVector()
    @curIndex     = 0

    @model.volumeTracing.on "newContour", (pos) => @addEdgePoint(pos)

    @reset()

  reset : ->

    edgeGeometry = new THREE.Geometry()
    edgeGeometry.dynamic = true

    @edgeBuffer = new Float32Array(MAX_EDGE_POINTS * 3)
    #{color: 0xff0000, linewidth: 2}, THREE.LineStrip
    @edge = new THREE.Line(edgeGeometry, new THREE.LineBasicMaterial(), THREE.LinePieces)
    @curIndex = 0

  getMeshes : ->
    return [@edge]

  addEdgePoint : (pos) ->
    curGlobalPos = @flycam.getGlobalPos()
    activePlane  = @flycam.getActivePlane()

    if @curIndex < MAX_EDGE_POINTS

      @edgeBuffer.set(pos, @curIndex * 3)
      @edge.geometry.__vertexArray = @edgeBuffer
      @edge.geometry.verticesNeedUpdate = true
      
      @curIndex++
      @flycam.hasChanged = true

  # Helper function
  calcScaleVector : (v) ->
    return (new THREE.Vector3()).multiply(v, @scaleVector)
