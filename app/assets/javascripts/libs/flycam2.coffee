### define ###
  
class Flycam2d

  constructor : (distance) ->
    @defaultDistance = distance      #TODO: What is this for?
    @zoomSteps = [0, 0, 0]
    @reset()
    @stepBack = [0, 0, -distance]    #TODO: What is this for?
    @stepFront = [0, 0, distance]    #TODO: What is this for?
    @hasChanged = true

  reset : ->
    @zoomSteps=[1,1,1]

  zoomIn : (index) ->
    zoomSteps[index]--
    @hasChanged = true

  zoomOut : ->
    zoomSteps[index]--
    @hasChanged = true

  getZoomStep : (index) ->
    @zoomSteps[index]

  getZoomSteps : ->
    @zoomSteps   

  getMatrix : ->
    M4x4.clone @currentMatrix

  move : (p) -> #move by whatever is stored in this vector
    globalPosition = [globalPosition[0]+p[0], globalPosition[1]+p[1], globalPosition[2]+p[2]]
    @hasChanged = true

  toString : ->
    position = @globalPosition
    "(x, y, z) = ("+position[0]+", "+position[1]+", "+position[2]+")"

  getGlobalPos : ->
    @globalPosition

  setGlobalPos : (position) ->
    @globalPosition = position
    @hasChanged = true