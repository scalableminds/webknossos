### define 
./volumelayer : VolumeLayer
###

class VolumeCell

  constructor : (@id) ->

    @layers = []            # List of VolumeLayers

  createLayer : ->
    layer = new VolumeLayer()
    @layers.push(layer)
    return @layer