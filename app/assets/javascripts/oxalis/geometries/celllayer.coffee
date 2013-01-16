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
    @edge = new THREE.Line(edgeGeometry, new THREE.LineBasicMaterial({color: 0xff0000, linewidth: 4}), THREE.LineStrip)
    @curIndex = 0

  getMeshes : ->
    return [@edge]

  addEdgePoint : (pos) ->
    curGlobalPos = @flycam.getGlobalPos()
    activePlane  = @flycam.getActivePlane()

    if @curIndex < MAX_EDGE_POINTS

      @edgeBuffer.set(pos, @curIndex * 3)
      @edge.geometry.__vertexArray = @edgeBuffer
      @edge.geometry.__webglLineCount = @curIndex
      @edge.geometry.verticesNeedUpdate = true
      
      @curIndex++
      if @curIndex % 100 == 0
        console.log "Celllayer curIndex:", @curIndex, "MAX_EDGE_POINTS", MAX_EDGE_POINTS
      @flycam.hasChanged = true

  # Helper function
  calcScaleVector : (v) ->
    return (new THREE.Vector3()).multiply(v, @scaleVector)
