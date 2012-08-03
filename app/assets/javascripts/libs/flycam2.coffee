### define ###

# constants (for active_plane)
PLANE_XY = 0
PLANE_YZ = 1
PLANE_XZ = 2
  
class Flycam2d

  constructor : (width) ->
    initialBuffer = 256-width/2          # buffer: how many pixels is the texture larger than the canvas on each side?
    @buffer = [initialBuffer, initialBuffer, initialBuffer]
    @viewportWidth = width
    @newBuckets = [false, false, false]
    @zoomSteps = [0.0, 0.0, 0.0]
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
    if @zoomSteps[planeID] < (3.3-0.05)
      @zoomSteps[planeID] += 0.05
      @hasChanged = true
      @buffer[planeID] = 256-@viewportWidth*@getTextureScalingFactor(planeID)/2

  getZoomStep : (planeID) ->  # round, because Model expects Integer
    steps = Math.round(@zoomSteps[planeID] + 0.2) # will round up if value is *.3
    if steps < 0
      return 0
    steps

  getTextureScalingFactor : (planeID) ->
    Math.pow(2, @zoomSteps[planeID])/Math.pow(2, @getZoomStep(planeID))

  getPlaneScalingFactor : (planeID) ->
    Math.pow(2, @zoomSteps[planeID])

  # Is this ever needed?
  #getZoomSteps : ->
  #  @zoomSteps   

  #getMatrix : ->
  #  M4x4.clone @currentMatrix

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
    f = (@getPlaneScalingFactor @activePlane)
    @move([p[0]*f, p[1]*f, p[2]*f])

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

  #needsUpdateXY : ->
  #  (( Math.abs(@globalPosition[0]-@texturePositionXY[0])>@buffer[PLANE_XY] or
  #    Math.abs(@globalPosition[1]-@texturePositionXY[1])>@buffer[PLANE_XY] or
  #    @globalPosition[2]!=@texturePositionXY[2] ) and @globalPosition!= [0,0,0]) or @newBuckets

  #needsUpdateYZ : ->
  #  (( Math.abs(@globalPosition[1]-@texturePositionYZ[1])>@buffer[PLANE_YZ] or
  #    Math.abs(@globalPosition[2]-@texturePositionYZ[2])>@buffer[PLANE_YZ] or
  #    @globalPosition[0]!=@texturePositionYZ[0] ) and @globalPosition!= [0,0,0])

  #needsUpdateXZ : ->
  #  (( Math.abs(@globalPosition[0]-@texturePositionXZ[0])>@buffer[PLANE_XZ] or
  #    Math.abs(@globalPosition[2]-@texturePositionXZ[2])>@buffer[PLANE_XZ] or
  #    @globalPosition[1]!=@texturePositionXZ[1] ) and @globalPosition!= [0,0,0])

  getIndices : (planeID) ->         # Returns a ordered 3-tuple [x, y, z] which
    switch planeID                  # represents the dimensions from the viewpoint
      when PLANE_XY then [0, 1, 2]  # of each plane. For example, moving along the
      when PLANE_YZ then [2, 1, 0]  # X-Axis of the YZ-Plane is eqivalent to moving
      when PLANE_XZ then [0, 2, 1]  # along the Z axis in the cube -> ind[0]=2

  needsUpdate : (planeID) ->
    ind = @getIndices planeID
    f   = @getPlaneScalingFactor planeID
    ( (Math.abs(@globalPosition[ind[0]]-@texturePosition[planeID][ind[0]]))/f>@buffer[planeID] or
      (Math.abs(@globalPosition[ind[1]]-@texturePosition[planeID][ind[1]]))/f>@buffer[planeID] or
      @globalPosition[ind[2]]!=@texturePosition[planeID][ind[2]] ) or @newBuckets[planeID]

  #getOffsetsXY : ->
  #  if @needsUpdateXY() then return [@buffer[PLANE_XY], @buffer[PLANE_XY]]
  #  [@globalPosition[0]-@texturePositionXY[0]+@buffer[PLANE_XY],
  #   @globalPosition[1]-@texturePositionXY[1]+@buffer[PLANE_XY]]

  #getOffsetsYZ : ->
  #  if @needsUpdateYZ() then return [@buffer[PLANE_YZ], @buffer[PLANE_YZ]]
  #  [@globalPosition[2]-@texturePositionYZ[2]+@buffer[PLANE_YZ],
  #   @globalPosition[1]-@texturePositionYZ[1]+@buffer[PLANE_YZ]]

  #getOffsetsXZ : ->
  #  if @needsUpdateXZ() then return [@buffer[PLANE_XZ], @buffer[PLANE_XZ]]
  #  [@globalPosition[0]-@texturePositionXZ[0]+@buffer[PLANE_XZ],
  #   @globalPosition[2]-@texturePositionXZ[2]+@buffer[PLANE_XZ]]

  getOffsets : (planeID) ->
    ind = @getIndices planeID
    f   = @getPlaneScalingFactor planeID
    #if @needsUpdate(planeID) then return [buffer[planeID], buffer[planeID]]
    [ (@globalPosition[ind[0]] - @texturePosition[planeID][ind[0]]) + @buffer[planeID],
      (@globalPosition[ind[1]] - @texturePosition[planeID][ind[1]]) + @buffer[planeID]]

  #notifyNewTextureXY : ->
  #  @texturePositionXY = @globalPosition.slice()    #copy that position
  #  @newBuckets = false

  #notifyNewTextureYZ : ->
  #  @texturePositionYZ = @globalPosition.slice()    #copy that position

  #notifyNewTextureXZ : ->
  #  @texturePositionXZ = @globalPosition.slice()    #copy that position

  notifyNewTexture : (planeID) ->
    @texturePosition[planeID] = @globalPosition.slice()    #copy that position
    @newBuckets[planeID] = false