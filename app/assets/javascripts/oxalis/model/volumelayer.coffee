class VolumeLayer
  
  constructor : (@time) ->
    
    unless @time?
      @time = (new Date()).getTime()
    @contourList = []
    @comment     = ""

  addContour : (x, y, z) ->
  	@contourList.push([x, y, z])