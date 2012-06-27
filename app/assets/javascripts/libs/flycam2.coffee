### define ###

# constants (for active_plane)
PLANE_XY = 0
PLANE_YZ = 1
PLANE_XZ = 2
  
class Flycam2d

  constructor : (distance) ->
    @buffer = 256-distance          # buffer: how many pixels is the texture larger than the canvas on each side?
    @defaultDistance = distance
    @zoomSteps = [0, 0, 0]
  #  @reset()
    @globalPosition = [0, 0, 0]
    @texturePositionXY = [0, 0, 0]
    @direction = [0, 0, 1]
    @stepBack = [0, 0, -distance]    #TODO: What is this for?
    @stepFront = [0, 0, distance]    #TODO: What is this for?
    @hasChanged = true
    @activePlane = PLANE_XY

  #reset : ->
  #  @zoomSteps=[1,1,1]

  zoomIn : (index) ->
    @zoomSteps[index]--
    @hasChanged = true

  zoomOut : (index) ->
    @zoomSteps[index]++
    @hasChanged = true

  getZoomStep : (index) ->
    @zoomSteps[index]

  getZoomSteps : ->
    @zoomSteps   

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

  setGlobalPos : (position) ->
    @globalPosition = position
    @hasChanged = true

  setActivePlane : (activePlane) ->
    @activePlane = activePlane

  getActivePlane : ->
    @activePlane

  needsUpdateXY : ->
    (( Math.abs(@globalPosition[0]-@texturePositionXY[0])>@buffer or
      Math.abs(@globalPosition[1]-@texturePositionXY[1])>@buffer or
      @globalPosition[2]!=@texturePositionXY[2] ) and @globalPosition!= [0,0,0])

  getOffsetsXY : ->
    [@globalPosition[0]-@texturePositionXY[0]+@buffer,
     @globalPosition[1]-@texturePositionXY[1]+@buffer]

  notifyNewTextureXY : ->
    @texturePositionXY = @globalPosition.slice()    #copy that position