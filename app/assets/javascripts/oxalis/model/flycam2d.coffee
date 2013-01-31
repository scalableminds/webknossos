### define
../../libs/event_mixin : EventMixin
./dimensions : DimensionsHelper
###

# constants (for active_plane)
PLANE_XY           = Dimensions.PLANE_XY
PLANE_YZ           = Dimensions.PLANE_YZ
PLANE_XZ           = Dimensions.PLANE_XZ
VIEW_3D            = Dimensions.VIEW_3D
TEXTURE_WIDTH      = 512
MAX_TEXTURE_OFFSET = 31     # maximum difference between requested coordinate and actual texture position
ZOOM_DIFF          = 0.1
MAX_ZOOM_TRESHOLD  = 2

  
class Flycam2d

  scaleInfo : null
  viewportWidth : 0


  constructor : (@viewportWidth, @scaleInfo, @zoomStepCount) ->

    _.extend(this, new EventMixin())

    console.log "ZoomStepCount: ", @zoomStepCount

    # Invariant: 2^zoomStep / 2^integerZoomStep <= 2^maxZoomDiff
    @maxZoomStepDiff = Math.min(Math.log(MAX_ZOOM_TRESHOLD) / Math.LN2, Math.log((TEXTURE_WIDTH-MAX_TEXTURE_OFFSET)/@viewportWidth)/Math.LN2)
    @hasNewTexture = [false, false, false]
    @zoomSteps = [0.0, 0.0, 0.0]
    @integerZoomSteps = [0, 0, 0]
    # buffer: how many pixels is the texture larger than the canvas on each dimension?
    # --> two dimensional array with buffer[planeID][dimension], dimension: x->0, y->1
    @buffer = [[0, 0], [0, 0], [0, 0]]
    @calculateBuffer()
    @position = [0, 0, 0]
    @texturePosition = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    @direction = [0, 0, 1]
    @hasChanged = true
    @activePlane = PLANE_XY
    @rayThreshold = [10, 10, 10, 100]
    @spaceDirection = [1, 1, 1]
    @quality = 0        # offset of integer zoom step to the best-quality zoom level

  zoomIn : (planeID) ->
    @setZoomStep(planeID, @zoomSteps[planeID] - ZOOM_DIFF)

  zoomOut : (planeID) ->
    # Make sure the max. zoom Step will not be exceded
    if @zoomSteps[planeID] < @zoomStepCount + @maxZoomStepDiff - ZOOM_DIFF
      @setZoomStep(planeID, @zoomSteps[planeID] + ZOOM_DIFF)

  zoomInAll : ->
    for i in [0..2]
      @zoomIn i

  zoomOutAll : ->
    for i in [0..2]
      @zoomOut i

  # Set offset to the best-possible zoom step
  setQuality : (value) ->
    @quality = value
    for i in [0..2]
      @calculateIntegerZoomStep(i)
    @hasChanged = true

  calculateIntegerZoomStep : (planeID) ->
    # round, because Model expects Integer
    @integerZoomSteps[planeID] = Math.ceil(@zoomSteps[planeID] - @maxZoomStepDiff + @quality)
    @integerZoomSteps[planeID] = Math.min(@integerZoomSteps[planeID], @zoomStepCount)
    @integerZoomSteps[planeID] = Math.max(@integerZoomSteps[planeID], 0)

  getZoomStep : (planeID) ->
    @zoomSteps[planeID]

  setZoomSteps : (zXY, zYZ, zXZ) ->
    zoomArray = [zXY, zYZ, zXZ]
    for planeID in [PLANE_XY, PLANE_YZ, PLANE_XZ]
      @setZoomStep(planeID, zoomArray[planeID])

  setZoomStep : (planeID, zoomStep) ->
    @zoomSteps[planeID] = zoomStep
    @hasChanged = true
    @calculateBuffer()
    @trigger "zoomFactorChanged", Math.pow(2, @zoomSteps[0]), @zoomSteps[0]

  calculateBuffer : ->
    for planeID in [PLANE_XY, PLANE_YZ, PLANE_XZ]
      scaleArray = Dimensions.transDim(@scaleInfo.baseVoxelFactors, planeID)
      base = @viewportWidth * @getTextureScalingFactor(planeID) / 2
      @buffer[planeID] = [TEXTURE_WIDTH/2 - base * scaleArray[0],
                          TEXTURE_WIDTH/2 - base * scaleArray[1]]

  getIntegerZoomStep : (planeID) ->
    @integerZoomSteps[planeID]

  getIntegerZoomSteps : ->
    @integerZoomSteps

  getTextureScalingFactor : (planeID) ->
    Math.pow(2, @zoomSteps[planeID])/Math.pow(2, @integerZoomSteps[planeID])

  getPlaneScalingFactor : (planeID) ->
    Math.pow(2, @zoomSteps[planeID])

  getDirection : ->
    @direction

  setDirection : (direction) ->
    @direction = direction
    @setSpaceDirection()

  setSpaceDirection : ->
    ind = Dimensions.getIndices @activePlane
    if @direction[ind[0]] <= 0 then @spaceDirection[ind[0]] = -1 else @spaceDirection[ind[0]] = 1
    if @direction[ind[1]] <= 0 then @spaceDirection[ind[1]] = -1 else @spaceDirection[ind[1]] = 1

  getSpaceDirection : ->
    @spaceDirection

  move : (p, planeID) ->  #move by whatever is stored in this vector
    if(planeID?)          # if planeID is given, use it to manipulate z
      # change direction of the value connected to space, based on the last direction
      p[Dimensions.getIndices(planeID)[2]] *= @spaceDirection[Dimensions.getIndices(planeID)[2]]
    @setPosition([@position[0]+p[0], @position[1]+p[1], @position[2]+p[2]])
    
  moveActivePlane : (p) -> # vector of voxels in BaseVoxels
    p = Dimensions.transDim(p, @activePlane)
    ind = Dimensions.getIndices(@activePlane)
    zoomFactor = Math.pow(2, @zoomSteps[@activePlane])
    scaleFactor = @scaleInfo.baseVoxelFactors
    delta = [p[0]*zoomFactor*scaleFactor[0], p[1]*zoomFactor*scaleFactor[1], p[2]*zoomFactor*scaleFactor[2]]
    @move(delta, @activePlane)

  toString : ->
    position = @position
    "(x, y, z) = ("+position[0]+", "+position[1]+", "+position[2]+")"

  getPosition : ->
    @position

  getTexturePosition : (planeID) ->
    @texturePosition[planeID]

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
    res = ((area[0] < 0) or (area[1] < 0) or (area[2] > TEXTURE_WIDTH) or (area[3] > TEXTURE_WIDTH) or
    (@position[ind[2]] != @texturePosition[planeID][ind[2]]) or
    (@zoomSteps[planeID] - (@integerZoomSteps[planeID]-1)) < @maxZoomStepDiff) or
    (@zoomSteps[planeID] -  @integerZoomSteps[planeID]     > @maxZoomStepDiff)
    return res

  # return the coordinate of the upper left corner of the viewport as texture-relative coordinate
  getOffsets : (planeID) ->
    ind = Dimensions.getIndices planeID
    [ (@position[ind[0]] - @texturePosition[planeID][ind[0]])/Math.pow(2, @integerZoomSteps[planeID]) + @buffer[planeID][0],
      (@position[ind[1]] - @texturePosition[planeID][ind[1]])/Math.pow(2, @integerZoomSteps[planeID]) + @buffer[planeID][1]]

  # returns [left, top, right, bottom] array
  getArea : (planeID) ->
    # convert scale vector to array in order to be able to use getIndices()
    scaleArray = @scaleInfo.baseVoxelFactors
    ind        = Dimensions.getIndices(planeID)
    offsets = @getOffsets(planeID)
    size    = @getTextureScalingFactor(planeID) * @viewportWidth
    # two pixels larger, just to fight rounding mistakes (important for mouse click conversion)
    #[offsets[0] - 1, offsets[1] - 1, offsets[0] + size * scaleArray[ind[0]] + 1, offsets[1] + size * scaleArray[ind[1]] + 1]
    [offsets[0], offsets[1], offsets[0] + size * scaleArray[ind[0]], offsets[1] + size * scaleArray[ind[1]]]

  notifyNewTexture : (planeID) ->
    @texturePosition[planeID] = @position.slice()    #copy that position
    @calculateIntegerZoomStep planeID
    # As the Model does not render textures for exact positions, the last 5 bits of
    # the X and Y coordinates for each texture have to be set to 0
    for i in [0..2]
      if i != (planeID+2)%3
        @texturePosition[planeID][i] &= -1 << (5 + @integerZoomSteps[planeID])
    @calculateBuffer()

  hasNewTextures : ->
    (@hasNewTexture[PLANE_XY] or @hasNewTexture[PLANE_YZ] or @hasNewTexture[PLANE_XZ])

  setRayThreshold : (cameraRight, cameraLeft) ->
    # in nm
    @rayThreshold[VIEW_3D] = 4 * (cameraRight - cameraLeft) / 384

  getRayThreshold : (planeID) ->
    if planeID < 3
      return @rayThreshold[planeID] * Math.pow(2, @zoomSteps[planeID]) * @scaleInfo.baseVoxel
    else
      return @rayThreshold[planeID]
