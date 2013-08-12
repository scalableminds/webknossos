### define
../../libs/event_mixin : EventMixin
./dimensions : Dimensions
../constants : constants
###
  
class Flycam2d

  TEXTURE_WIDTH      : 512
  MAX_TEXTURE_OFFSET : 31     # maximum difference between requested coordinate and actual texture position
  MAX_ZOOM_THRESHOLD  : 2

  scaleInfo : null
  viewportWidth : 0

  constructor : (@viewportWidth, @scaleInfo, @zoomStepCount, @user) ->

    _.extend(this, new EventMixin())

    console.log "ZoomStepCount: ", @zoomStepCount

    # Invariant: 2^zoomStep / 2^integerZoomStep <= 2^maxZoomDiff
    @maxZoomStepDiff = Math.min(Math.log(@MAX_ZOOM_THRESHOLD) / Math.LN2, Math.log((@TEXTURE_WIDTH-@MAX_TEXTURE_OFFSET)/@viewportWidth)/Math.LN2)
    @hasNewTexture = [false, false, false]
    @zoomStep = 0.0
    @integerZoomStep = 0
    # buffer: how many pixels is the texture larger than the canvas on each dimension?
    # --> two dimensional array with buffer[planeID][dimension], dimension: x->0, y->1
    @buffer = [[0, 0], [0, 0], [0, 0]]
    @calculateBuffer()
    @position = [0, 0, 0]
    @direction = [0, 0, 1]
    @hasChanged = true
    @activePlane = constants.PLANE_XY
    @rayThreshold = [10, 10, 10, 100]
    @spaceDirection = [1, 1, 1]
    @quality = 0        # offset of integer zoom step to the best-quality zoom level

    # correct zoom values that are too high
    @user.setValue("zoom", Math.min(@user.zoom, Math.floor(@getMaxZoomStep())))

    @user.on({
      qualityChanged : (quality) => @setQuality(quality)
      zoomChanged : (zoomFactor) => @zoom(Math.log(zoomFactor) / Math.LN2)
      })

  zoomIn : ->

    @zoom(@zoomStep - constants.ZOOM_DIFF)


  zoomOut : ->

    @zoom(@zoomStep + constants.ZOOM_DIFF)


  zoom : (zoom) ->

    # Make sure the max. zoom Step will not be exceded
    if zoom < @zoomStepCount + @maxZoomStepDiff
      @setZoomStep(zoom)


  # Set offset to the best-possible zoom step
  setQuality : (value) ->

    @quality = value
    for i in [0..2]
      @calculateIntegerZoomStep()
    @hasChanged = true


  calculateIntegerZoomStep : ->

    # round, because Model expects Integer
    @integerZoomStep = Math.ceil(@zoomStep - @maxZoomStepDiff + @quality)
    @integerZoomStep = Math.min(@integerZoomStep, @zoomStepCount)
    @integerZoomStep = Math.max(@integerZoomStep, 0)


  getZoomStep : ->

    @zoomStep


  setZoomStep : (zoomStep) ->

    @zoomStep = zoomStep
    @hasChanged = true
    @calculateIntegerZoomStep()
    @calculateBuffer()


  getMaxZoomStep : ->

    Math.pow(2, @zoomStepCount + @maxZoomStepDiff)


  calculateBuffer : ->

    for planeID in [constants.PLANE_XY, constants.PLANE_YZ, constants.PLANE_XZ]
      scaleArray = Dimensions.transDim(@scaleInfo.baseVoxelFactors, planeID)
      base = @viewportWidth * @getTextureScalingFactor() / 2
      @buffer[planeID] = [@TEXTURE_WIDTH/2 - base * scaleArray[0],
                          @TEXTURE_WIDTH/2 - base * scaleArray[1]]


  getIntegerZoomStep : ->

    @integerZoomStep


  getTextureScalingFactor : ->

    Math.pow(2, @zoomStep)/Math.pow(2, @integerZoomStep)


  getPlaneScalingFactor : ->

    Math.pow(2, @zoomStep)


  getDirection : ->

    @direction


  setDirection : (direction) ->

    @direction = direction
    if @user.dynamicSpaceDirection
      @setSpaceDirection(direction)


  setSpaceDirection : (direction) ->

    for index in [0..2]
      if direction[index] <= 0 then @spaceDirection[index] = -1 else @spaceDirection[index] = 1


  getSpaceDirection : ->

    @spaceDirection


  move : (p, planeID) ->  #move by whatever is stored in this vector

    if(planeID?)          # if planeID is given, use it to manipulate z
      # change direction of the value connected to space, based on the last direction
      p[Dimensions.getIndices(planeID)[2]] *= @spaceDirection[Dimensions.getIndices(planeID)[2]]
    @setPosition([@position[0]+p[0], @position[1]+p[1], @position[2]+p[2]])

    
  moveActivePlane : (p, increaseSpeedWithZoom = true) -> # vector of voxels in BaseVoxels

    p = Dimensions.transDim(p, @activePlane)
    ind = Dimensions.getIndices(@activePlane)
    zoomFactor = if increaseSpeedWithZoom then Math.pow(2, @zoomStep) else 1
    scaleFactor = @scaleInfo.baseVoxelFactors
    delta = [p[0] * zoomFactor * scaleFactor[0],
              p[1] * zoomFactor * scaleFactor[1],
              p[2] * zoomFactor * scaleFactor[2]]
    @move(delta, @activePlane)


  toString : ->

    position = @position
    "(x, y, z) = ("+position[0]+", "+position[1]+", "+position[2]+")"


  getPosition : ->

    @position


  getTexturePosition : (planeID) ->
    
    texturePosition = @position.slice()    #copy that position
    # As the Model does not render textures for exact positions, the last 5 bits of
    # the X and Y coordinates for each texture have to be set to 0
    for i in [0..2]
      if i != (planeID+2)%3
        texturePosition[i] &= -1 << (5 + @integerZoomStep)

    return texturePosition


  setPositionSilent : (position) ->

    @position = position
    @hasChanged = true


  setPosition : (position) ->

    @setPositionSilent(position)
    @trigger("positionChanged", position)

    
  setActivePlane : (activePlane) ->

    @activePlane = activePlane


  getActivePlane : ->

    @activePlane


  needsUpdate : (planeID) ->
  
    area = @getArea planeID
    ind  = Dimensions.getIndices planeID
    res = ((area[0] < 0) or (area[1] < 0) or (area[2] > @TEXTURE_WIDTH) or (area[3] > @TEXTURE_WIDTH) or
    (@position[ind[2]] != @getTexturePosition(planeID)[ind[2]]) or
    (@zoomStep - (@integerZoomStep-1)) < @maxZoomStepDiff) or
    (@zoomStep -  @integerZoomStep     > @maxZoomStepDiff)
    return res


  getOffsets : (planeID) ->
    # return the coordinate of the upper left corner of the viewport as texture-relative coordinate

    ind = Dimensions.getIndices planeID
    [ (@position[ind[0]] - @getTexturePosition(planeID)[ind[0]])/Math.pow(2, @integerZoomStep) + @buffer[planeID][0],
      (@position[ind[1]] - @getTexturePosition(planeID)[ind[1]])/Math.pow(2, @integerZoomStep) + @buffer[planeID][1]]

  
  getArea : (planeID) ->
    # returns [left, top, right, bottom] array

    # convert scale vector to array in order to be able to use getIndices()
    scaleArray = @scaleInfo.baseVoxelFactors
    ind        = Dimensions.getIndices(planeID)
    offsets = @getOffsets(planeID)
    size    = @getTextureScalingFactor() * @viewportWidth
    # two pixels larger, just to fight rounding mistakes (important for mouse click conversion)
    #[offsets[0] - 1, offsets[1] - 1, offsets[0] + size * scaleArray[ind[0]] + 1, offsets[1] + size * scaleArray[ind[1]] + 1]
    [offsets[0], offsets[1], offsets[0] + size * scaleArray[ind[0]], offsets[1] + size * scaleArray[ind[1]]]


  hasNewTextures : ->

    (@hasNewTexture[constants.PLANE_XY] or @hasNewTexture[constants.PLANE_YZ] or @hasNewTexture[constants.PLANE_XZ])


  setRayThreshold : (cameraRight, cameraLeft) ->

    # in nm
    @rayThreshold[constants.VIEW_3D] = 8 * (cameraRight - cameraLeft) / 384


  getRayThreshold : (planeID) ->

    if planeID < 3
      return @rayThreshold[planeID] * Math.pow(2, @zoomStep) * @scaleInfo.baseVoxel
    else
      return @rayThreshold[planeID]


  update : ->

    @hasChanged = true


