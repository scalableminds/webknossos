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
    @newBuckets = false
    @zoomSteps = [0, 0, 0]
  #  @reset()
    @globalPosition = [0, 0, 0]
    @texturePositionXY = [0, 0, 0]
    @texturePositionYZ = [0, 0, 0]
    @texturePositionXZ = [0, 0, 0]
    @direction = [0, 0, 1]
    @hasChanged = true
    @activePlane = PLANE_XY

  #reset : ->
  #  @zoomSteps=[1,1,1]

  zoomIn : (index) ->
    @zoomSteps[index] -= 0.05
    @hasChanged = true
    @buffer[index] = 256-@viewportWidth*@getTextureScalingFactor(index)/2

  zoomOut : (index) ->
    if @zoomSteps[index] < (3.3-0.05)
      @zoomSteps[index] += 0.05
      @hasChanged = true
      @buffer[index] = 256-@viewportWidth*@getTextureScalingFactor(index)/2

  getZoomStep : (index) ->  # round, because Model expects Integer
    steps = Math.round(@zoomSteps[index] + 0.2) # will round up if value is *.3
    if steps < 0
      return 0
    steps

  getTextureScalingFactor : (index) ->
    Math.pow(2, @zoomSteps[index])/Math.pow(2, @getZoomStep(index))

  getPlaneScalingFactor : (index) ->
    Math.pow(2, @zoomSteps[index])

  # Is this ever needed?
  #getZoomSteps : ->
  #  @zoomSteps   

  getMatrix : ->
    M4x4.clone @currentMatrix

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

  toString : ->
    position = @globalPosition
    "(x, y, z) = ("+position[0]+", "+position[1]+", "+position[2]+")"

  getGlobalPos : ->
    @globalPosition

  getTexturePositionXY : ->
    @texturePositionXY

  getTexturePositionYZ : ->
    @texturePositionYZ

  getTexturePositionXZ : ->
    @texturePositionXZ

  setGlobalPos : (position) ->
    @globalPosition = position
    @hasChanged = true

  setActivePlane : (activePlane) ->
    @activePlane = activePlane

  getActivePlane : ->
    @activePlane

  needsUpdateXY : ->
    (( Math.abs(@globalPosition[0]-@texturePositionXY[0])>@buffer[PLANE_XY] or
      Math.abs(@globalPosition[1]-@texturePositionXY[1])>@buffer[PLANE_XY] or
      @globalPosition[2]!=@texturePositionXY[2] ) and @globalPosition!= [0,0,0]) or @newBuckets

  getOffsetsXY : ->
    if @needsUpdateXY() then return [@buffer[PLANE_XY], @buffer[PLANE_XY]]
    [@globalPosition[0]-@texturePositionXY[0]+@buffer[PLANE_XY],
     @globalPosition[1]-@texturePositionXY[1]+@buffer[PLANE_XY]]

  notifyNewTextureXY : ->
    @texturePositionXY = @globalPosition.slice()    #copy that position
    @newBuckets = false

  needsUpdateYZ : ->
    (( Math.abs(@globalPosition[1]-@texturePositionYZ[1])>@buffer[PLANE_YZ] or
      Math.abs(@globalPosition[2]-@texturePositionYZ[2])>@buffer[PLANE_YZ] or
      @globalPosition[0]!=@texturePositionYZ[0] ) and @globalPosition!= [0,0,0])

  getOffsetsYZ : ->
    if @needsUpdateYZ() then return [@buffer[PLANE_YZ], @buffer[PLANE_YZ]]
    [@globalPosition[2]-@texturePositionYZ[2]+@buffer[PLANE_YZ],
     @globalPosition[1]-@texturePositionYZ[1]+@buffer[PLANE_YZ]]

  notifyNewTextureYZ : ->
    @texturePositionYZ = @globalPosition.slice()    #copy that position

  needsUpdateXZ : ->
    (( Math.abs(@globalPosition[0]-@texturePositionXZ[0])>@buffer[PLANE_XZ] or
      Math.abs(@globalPosition[2]-@texturePositionXZ[2])>@buffer[PLANE_XZ] or
      @globalPosition[1]!=@texturePositionXZ[1] ) and @globalPosition!= [0,0,0])

  getOffsetsXZ : ->
    if @needsUpdateXZ() then return [@buffer[PLANE_XZ], @buffer[PLANE_XZ]]
    [@globalPosition[0]-@texturePositionXZ[0]+@buffer[PLANE_XZ],
     @globalPosition[2]-@texturePositionXZ[2]+@buffer[PLANE_XZ]]

  notifyNewTextureXZ : ->
    @texturePositionXZ = @globalPosition.slice()    #copy that position