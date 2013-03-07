### define 
./volumelayer : VolumeLayer
./dimensions : Dimensions
###

class VolumeCell

  constructor : (@id) ->

    @layers = []            # List of VolumeLayers
    @idCount = 1

  createLayer : (planeId, thirdDimensionValue) ->
    if @getLayer(planeId, thirdDimensionValue) != null
      return null
    layer = new VolumeLayer(this, planeId, thirdDimensionValue, @idCount++)
    @layers.push(layer)
    return layer

  getLayer : (planeId, thirdDimensionValue) ->

    thirdDimensionValue = Dimensions.round(thirdDimensionValue)

    for layer in @layers
      if layer.plane == planeId and layer.thirdDimensionValue == thirdDimensionValue
        return layer
    return null

  getVoxelArray : ->

    if @layers.length == 0
      return []

    res = []
    for layer in @layers
      res.push(layer.getVoxelArray())