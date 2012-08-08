### define ###

# constants (for active_plane)
PLANE_XY      = 0
PLANE_YZ      = 1
PLANE_XZ      = 2
TEXTURE_WIDTH = 512
  
class Flycam2d

  constructor : (width) ->
    initialBuffer = 256-width/2          # buffer: how many pixels is the texture larger than the canvas on each side?
    @buffer = [initialBuffer, initialBuffer, initialBuffer]
    @viewportWidth = width
    @newBuckets = [false, false, false]
    @zoomSteps = [0.0, 0.0, 0.0]
    @integerZoomSteps = [0, 0, 0]
  #  @reset()
    @globalPosition = [0, 0, 0]
    @texturePosition = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    @direction = [0, 0, 1]
    @hasChanged = true
    @activePlane = PLANE_XY

  #reset : ->
  #  @zoomSteps=[1,1,1]

  zoomIn : (planeID) ->
    @zoomSteps[planeID] -= 0.05
    @hasChanged = true
    @buffer[planeID] = 256-@viewportWidth*@getTextureScalingFactor(planeID)/2

  zoomOut : (planeID) ->
    if @zoomSteps[planeID] < (3.25-0.05)
      @zoomSteps[planeID] += 0.05
      @hasChanged = true
      @buffer[planeID] = 256-@viewportWidth*@getTextureScalingFactor(planeID)/2

  zoomInAll : ->
    for i in [0..2]
      @zoomIn i

  zoomOutAll : ->
    for i in [0..2]
      @zoomOut i

  calculateIntegerZoomStep : (planeID) ->                                 # round, because Model expects Integer
    @integerZoomSteps[planeID] = Math.round(@zoomSteps[planeID] + 0.25)   # will round up if value is *.25
    if @integerZoomSteps[planeID] < 0
      @integerZoomSteps[planeID] = 0

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

  move : (p) -> #move by whatever is stored in this vector
    @globalPosition = [@globalPosition[0]+p[0], @globalPosition[1]+p[1], @globalPosition[2]+p[2]]
    @hasChanged = true
    # update the direction whenever the user moves
    @lastDirection = @direction
    @direction = [0.8 * @lastDirection[0] + 0.2 * p[0], 0.8 * @lastDirection[1] + 0.2 * p[1], 0.8 * @lastDirection[2] + 0.2 * p[2]]

  moveActivePlane : (p) ->
    ind = @getIndices @activePlane
    f = (@getPlaneScalingFactor @activePlane)
    @move([p[ind[0]]*f, p[ind[1]]*f, p[ind[2]]*f])

  toString : ->
    position = @globalPosition
    "(x, y, z) = ("+position[0]+", "+position[1]+", "+position[2]+")"

  getGlobalPos : ->
    @globalPosition

  getTexturePosition : (planeID) ->
    @texturePosition[planeID]

  setGlobalPos : (position) ->
    @globalPosition = position
    @hasChanged = true

  setActivePlane : (activePlane) ->
    @activePlane = activePlane

  getActivePlane : ->
    @activePlane

  getIndices : (planeID) ->         # Returns a ordered 3-tuple [x, y, z] which
    switch planeID                  # represents the dimensions from the viewpoint
      when PLANE_XY then [0, 1, 2]  # of each plane. For example, moving along the
      when PLANE_YZ then [2, 1, 0]  # X-Axis of the YZ-Plane is eqivalent to moving
      when PLANE_XZ then [0, 2, 1]  # along the Z axis in the cube -> ind[0]=2

  needsUpdate : (planeID) ->
    area = @getArea planeID
    ind  = @getIndices planeID
    ((area[0] < 0) or (area[1] < 0) or (area[2] > TEXTURE_WIDTH) or (area[3] > TEXTURE_WIDTH) or
      (@globalPosition[ind[2]] != @texturePosition[planeID][ind[2]]) or
      (@integerZoomSteps[planeID] - @zoomSteps[planeID]) > 0.75)

  getOffsets : (planeID) ->
    ind = @getIndices planeID
    [ (@globalPosition[ind[0]] - @texturePosition[planeID][ind[0]])/Math.pow(2, @integerZoomSteps[planeID]) + @buffer[planeID],
      (@globalPosition[ind[1]] - @texturePosition[planeID][ind[1]])/Math.pow(2, @integerZoomSteps[planeID]) + @buffer[planeID]]

  getArea : (planeID) ->
    offsets = @getOffsets planeID
    size    = @getTextureScalingFactor(planeID) * @viewportWidth
    [offsets[0], offsets[1], offsets[0] + size, offsets[1] + size]
    #[offsets[0], offsets[0] + size, offsets[1], offsets[1] + size]

  notifyNewTexture : (planeID) ->
    @texturePosition[planeID] = @globalPosition.slice()    #copy that position
    @calculateIntegerZoomStep planeID
    # As the Model does not render textures for exact positions, the last 5 bits of
    # the X and Y coordinates for each texture have to be set to 0
    for i in [0..2]
      if i != (planeID+2)%3
        @texturePosition[planeID][i] &= -1 << (5 + @integerZoomSteps[planeID])
    @buffer[planeID] = 256-@viewportWidth*@getTextureScalingFactor(planeID)/2
    @newBuckets[planeID] = false
