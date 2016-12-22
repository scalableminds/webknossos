app        = require("app")
Dimensions = require("./dimensions")
constants  = require("../constants")

class Flycam2d

  TEXTURE_WIDTH       : 512
  MAX_TEXTURE_OFFSET  : 31     # maximum difference between requested coordinate and actual texture position
  MAX_ZOOM_THRESHOLD  : 2

  viewportWidth : 0

  constructor : (@viewportWidth, @zoomStepCount, @model) ->

    _.extend(this, Backbone.Events)

    console.log "ZoomStepCount: ", @zoomStepCount

    @user = @model.user

    @maxZoomStepDiff = @calculateMaxZoomStepDiff()
    @zoomStep = 0.0
    @integerZoomStep = 0
    # buffer: how many pixels is the texture larger than the canvas on each dimension?
    # --> two dimensional array with buffer[planeID][dimension], dimension: x->0, y->1
    @buffer = [[0, 0], [0, 0], [0, 0]]
    @position = [0, 0, 0]
    @direction = [0, 0, 1]
    @rayThreshold = [10, 10, 10, 100]
    @spaceDirection = [1, 1, 1]
    @quality = 0 # offset of integer zoom step to the best-quality zoom level

    @updateStoredValues()

    # correct zoom values that are too high or too low
    @user.set("zoom", Math.max(0.01, Math.min(@user.get("zoom"), Math.floor(@getMaxZoomStep()))))

    @listenTo(@model.get("datasetConfiguration"), "change:quality", (model, quality) -> @setQuality(quality))
    # TODO move zoom into tracing settings
    @listenTo(@user, "change:zoom", (model, zoomFactor) -> @zoom(Math.log(zoomFactor) / Math.LN2))

    # Fire changed event every time
    _trigger = @trigger
    @trigger = =>
      _trigger.apply(this, arguments)
      _trigger.call(this, "changed")


  calculateMaxZoomStepDiff : ->
    # Invariant: 2^zoomStep / 2^integerZoomStep <= 2^maxZoomDiff

    zoomThreshold = Math.min(
      @MAX_ZOOM_THRESHOLD,
      (@TEXTURE_WIDTH - @MAX_TEXTURE_OFFSET) / @viewportWidth
    )
    return Math.log(zoomThreshold) / Math.LN2


  zoomByDelta : (delta) ->

    @zoom(@zoomStep - delta * constants.ZOOM_DIFF)


  zoom : (zoom) ->

    # Make sure the max. zoom Step will not be exceded
    if zoom < @zoomStepCount + @maxZoomStepDiff
      @setZoomStep(zoom)


  setQuality : (value) ->
    # Set offset to the best-possible zoom step

    @quality = value
    @updateStoredValues()
    @update()


  calculateIntegerZoomStep : ->

    # round, because Model expects Integer
    @integerZoomStep = Math.ceil(@zoomStep - @maxZoomStepDiff + @quality)
    @integerZoomStep = Math.min(@integerZoomStep, @zoomStepCount)
    @integerZoomStep = Math.max(@integerZoomStep, 0)


  getZoomStep : ->

    @zoomStep


  setZoomStep : (zoomStep) ->

    @zoomStep = zoomStep
    @update()
    @updateStoredValues()
    @trigger("zoomStepChanged", zoomStep)


  getMaxZoomStep : ->

    maxZoomStep = @zoomStepCount - 1
    Math.pow(2, maxZoomStep + @maxZoomStepDiff)


  calculateBuffer : ->

    for planeID in [0..2]
      scaleArray = Dimensions.transDim(app.scaleInfo.baseVoxelFactors, planeID)
      pixelNeeded = @viewportWidth * @getTextureScalingFactor()
      @buffer[planeID] = [@TEXTURE_WIDTH - pixelNeeded * scaleArray[0],
                          @TEXTURE_WIDTH - pixelNeeded * scaleArray[1]]


  updateStoredValues : ->

    @calculateIntegerZoomStep()
    @calculateBuffer()


  getIntegerZoomStep : ->

    unless @integerZoomStep
      @calculateIntegerZoomStep()

    return @integerZoomStep


  getTextureScalingFactor : ->

    Math.pow(2, @zoomStep)/Math.pow(2, @integerZoomStep)


  getPlaneScalingFactor : ->

    Math.pow(2, @zoomStep)


  getDirection : ->

    @direction


  setDirection : (direction) ->

    @direction = direction
    if @user.get("dynamicSpaceDirection")
      @setSpaceDirection(direction)


  setSpaceDirection : (direction) ->

    for index in [0..2]
      if direction[index] <= 0 then @spaceDirection[index] = -1 else @spaceDirection[index] = 1


  getSpaceDirection : ->

    @spaceDirection


  getRotation : (planeID) ->

    return switch planeID
      when constants.PLANE_XY then [0, 0, 0]
      when constants.PLANE_YZ then [0, 270, 0]
      when constants.PLANE_XZ then [90, 0, 0]


  move : (p, planeID) ->  #move by whatever is stored in this vector

    if(planeID?)          # if planeID is given, use it to manipulate z
      # change direction of the value connected to space, based on the last direction
      p[Dimensions.getIndices(planeID)[2]] *= @spaceDirection[Dimensions.getIndices(planeID)[2]]
    @setPosition([@position[0]+p[0], @position[1]+p[1], @position[2]+p[2]])


  movePlane : (vector, planeID, increaseSpeedWithZoom = true) -> # vector of voxels in BaseVoxels

    vector = Dimensions.transDim(vector, planeID)
    ind = Dimensions.getIndices(planeID)
    zoomFactor = if increaseSpeedWithZoom then Math.pow(2, @zoomStep) else 1
    scaleFactor = app.scaleInfo.baseVoxelFactors
    delta = [ vector[0] * zoomFactor * scaleFactor[0],
              vector[1] * zoomFactor * scaleFactor[1],
              vector[2] * zoomFactor * scaleFactor[2]]
    @move(delta, planeID)


  toString : ->

    position = @position
    "(x, y, z) = ("+position[0]+", "+position[1]+", "+position[2]+")"


  getPosition : ->

    return @position


  getViewportBoundingBox : ->

    position = @getPosition()
    offset   = @getPlaneScalingFactor() * @viewportWidth / 2
    min      = []
    max      = []

    for i in [0..2]
      min.push( position[i] - offset * app.scaleInfo.baseVoxelFactors[i] )
      max.push( position[i] + offset * app.scaleInfo.baseVoxelFactors[i] )

    return { min, max }


  getTexturePosition : (planeID) ->

    texturePosition = @position.slice()    #copy that position
    # As the Model does not render textures for exact positions, the last 5 bits of
    # the X and Y coordinates for each texture have to be set to 0
    for i in [0..2]
      if i != Dimensions.getIndices(planeID)[2]
        texturePosition[i] &= -1 << (5 + @integerZoomStep)

    return texturePosition


  setPositionSilent : (position) ->

    for i in [0..2]
      if not position[i]?
        position[i] = @position[i]

    @position = position
    @update()


  setPosition : (position) ->

    @setPositionSilent(position)
    @trigger("positionChanged", position)


  needsUpdate : (planeID) ->

    area = @getArea planeID
    ind  = Dimensions.getIndices planeID
    res = ((area[0] < 0) or (area[1] < 0) or (area[2] > @TEXTURE_WIDTH) or (area[3] > @TEXTURE_WIDTH) or
    #(@position[ind[2]] != @getTexturePosition(planeID)[ind[2]]) or # TODO: always false
    (@zoomStep - (@integerZoomStep-1)) < @maxZoomStepDiff) or
    (@zoomStep -  @integerZoomStep     > @maxZoomStepDiff)
    return res


  getOffsets : (planeID) ->
    # return the coordinate of the upper left corner of the viewport as texture-relative coordinate

    ind = Dimensions.getIndices planeID
    [ @buffer[planeID][0]/2 + (@position[ind[0]] - @getTexturePosition(planeID)[ind[0]])/Math.pow(2, @integerZoomStep),
      @buffer[planeID][1]/2 + (@position[ind[1]] - @getTexturePosition(planeID)[ind[1]])/Math.pow(2, @integerZoomStep)]


  getArea : (planeID) ->
    # returns [left, top, right, bottom] array

    # convert scale vector to array in order to be able to use getIndices()
    scaleArray = Dimensions.transDim( app.scaleInfo.baseVoxelFactors, planeID )
    offsets    = @getOffsets(planeID)
    size       = @getTextureScalingFactor() * @viewportWidth
    # two pixels larger, just to fight rounding mistakes (important for mouse click conversion)
    #[offsets[0] - 1, offsets[1] - 1, offsets[0] + size * scaleArray[ind[0]] + 1, offsets[1] + size * scaleArray[ind[1]] + 1]
    [offsets[0], offsets[1], offsets[0] + size * scaleArray[0], offsets[1] + size * scaleArray[1]]


  getAreas : ->

    result = []
    for i in [0..2]
      result.push( @getArea(i) )
    return result


  setRayThreshold : (cameraRight, cameraLeft) ->

    # in nm
    @rayThreshold[constants.TDView] = 8 * (cameraRight - cameraLeft) / 384


  getRayThreshold : (planeID) ->

    if planeID < 3
      return @rayThreshold[planeID] * Math.pow(2, @zoomStep) * app.scaleInfo.baseVoxel
    else
      return @rayThreshold[planeID]


  update : ->

    app.vent.trigger("rerender")

module.exports = Flycam2d
