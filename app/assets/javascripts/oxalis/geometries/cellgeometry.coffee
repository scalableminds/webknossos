### define
../../libs/event_mixin : EventMixin
../model/dimensions : Dimensions
../../libs/resizable_buffer : ResizableBuffer
###

PLANE_XY         = Dimensions.PLANE_XY
PLANE_YZ         = Dimensions.PLANE_YZ
PLANE_XZ         = Dimensions.PLANE_XZ

COLOR_NORMAL     = 0xff0000
COLOR_ARRAY      = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0x00ffff, 0xff00ff]
COLOR_ACTIVE     = 0x000000

class CellGeometry

  constructor : (model, cell) ->

    @layers = []      # One layer per plane
    for i in [0..2]
      @layers.push(new CellLayer(model, cell, i))

  getMeshes : ->
    res = []
    for layer in @layers
      res = res.concat(layer.getMeshes())
    return res

  class CellLayer

    constructor : (@model, @cell, @planeId) ->

      _.extend(this, new EventMixin())

      @thirdDimension = Dimensions.thirdDimensionForPlane(@planeId)
      @id = null

      @color = COLOR_ARRAY[ @cell.id % COLOR_ARRAY.length]

      @model.volumeTracing.on({
        newContour : (cellId, layerId, pos, useHelper) =>
          if @cell.id == cellId and @id == layerId
            @addEdgePoint(pos, useHelper)
        newLayer : (cellId) =>
          if @cell.id == cellId
            @update()
        layerUpdate : =>
          @update(true)
        })
      @model.flycam.on({
        positionChanged : (pos) =>
          @update()
        })

      @createMeshes()

    update : (force = false) ->

      pos = @model.flycam.getPosition()
      layer = @cell.getLayer(@planeId, pos[@thirdDimension])

      if not layer? or layer.id != @id or force
        
        @reset()
        if layer?
          @id = layer.id

          for vertex in layer.contourList
            @addEdgePoint(vertex)
        
        else
          @id = null

      if @model.volumeTracing.isActiveLayer(@cell.id, @id)
        @edge.material.color.set(COLOR_ACTIVE)
      else
        @edge.material.color.set(@color)

      @model.flycam.hasChanged = true

    createMeshes : ->

      edgeGeometry = new THREE.Geometry()
      edgeGeometry.dynamic = true
      helperEdgeGeometry = new THREE.Geometry()
      helperEdgeGeometry.dynamic = true

      @edge = new THREE.Line(edgeGeometry, new THREE.LineBasicMaterial({color: @color, linewidth: 4}), THREE.LineStrip)
      @edge.vertexBuffer = new ResizableBuffer(3)
      @helperEdge = new THREE.Line(helperEdgeGeometry, new THREE.LineBasicMaterial({color: COLOR_ACTIVE, linewidth: 4}), THREE.LineStrip)
      @helperEdge.vertexBuffer = new ResizableBuffer(3)

      @reset()

    reset : ->
      @edge.vertexBuffer.clear()
      @finalizeMesh(@edge)
      @helperEdge.vertexBuffer.clear()
      @finalizeMesh(@helperEdge)

    getMeshes : ->
      return [@edge, @helperEdge]

    addEdgePoint : (pos, useHelper) ->

      # pos might be integer, but the third dimension needs to be exact.
      globalPos = @model.flycam.getPosition()
      edgePoint = pos.slice()
      edgePoint[@thirdDimension] = globalPos[@thirdDimension]

      mesh = if useHelper then @helperEdge else @edge
      mesh.vertexBuffer.push(edgePoint)
      @finalizeMesh(mesh)
      
      @model.flycam.hasChanged = true

    finalizeMesh : (mesh) ->
      mesh.geometry.__vertexArray = mesh.vertexBuffer.getBuffer()
      mesh.geometry.__webglLineCount = mesh.vertexBuffer.getLength()
      mesh.geometry.verticesNeedUpdate = true